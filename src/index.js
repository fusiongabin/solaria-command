require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
  REST,
  Routes,
  MessageFlags,
} = require("discord.js");
const config = require("../config.json");
const db = require("./database");
const commandList = require("./commands");
const orders = require("./orders");
const suggestions = require("./suggestions");
const { handleOpenTicket, handleCloseTicket, handleReportModalSubmit, handleOtherTicketModalSubmit, handleBannerOrderCommand, handleBannerOrderModalSubmit } = require("./tickets");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});

client.commands = new Collection();
for (const cmd of commandList) client.commands.set(cmd.data.name, cmd);

// ---------------- Déploiement automatique des slash commands au démarrage ----------------
// Certains hébergeurs (Pterodactyl et similaires) ne permettent pas de lancer
// `npm run deploy` séparément : on le fait donc systématiquement avant de se connecter.
async function autoDeployCommands() {
  if (!process.env.CLIENT_ID || !process.env.GUILD_ID) {
    console.warn("⚠️ CLIENT_ID ou GUILD_ID manquant, déploiement des commandes ignoré.");
    return;
  }
  try {
    const body = commandList.map((c) => c.data.toJSON());
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body });
    console.log(`✅ ${body.length} commande(s) slash déployée(s) automatiquement.`);
  } catch (err) {
    console.error("❌ Échec du déploiement automatique des commandes :", err.message);
  }
}

// ---------------- Filet de sécurité global : ne JAMAIS laisser une erreur planter le process ----------------
// Sans ça, la moindre erreur async non "catchée" tue tout le bot (Node.js termine le process
// par défaut sur un rejet de promesse non géré) — le bot redémarre alors en boucle et TOUTES
// les interactions échouent avec "L'application n'a pas répondu à temps" pendant ce temps-là.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Promesse rejetée non gérée (le bot continue de tourner) :", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Exception non interceptée (le bot continue de tourner) :", err);
});

// ---------------- Suivi de la connexion Discord (websocket) ----------------
// Sans ces écouteurs, une erreur ou une déconnexion du websocket peut rendre le bot
// injoignable (interactions qui timeout) sans forcément faire planter le process,
// donc sans message d'erreur visible. On logge tout ici pour pouvoir diagnostiquer.
client.on("error", (err) => {
  console.error("⚠️ Erreur client Discord :", err);
});
client.on("shardError", (err, shardId) => {
  console.error(`⚠️ Erreur sur le shard ${shardId} :`, err);
});
client.on("shardDisconnect", (event, shardId) => {
  console.warn(`🔌 Shard ${shardId} déconnecté (code ${event?.code}).`);
});
client.on("shardReconnecting", (shardId) => {
  console.warn(`🔄 Shard ${shardId} en cours de reconnexion...`);
});
client.on("shardResume", (shardId) => {
  console.log(`✅ Shard ${shardId} reconnecté.`);
});
client.on("warn", (info) => {
  console.warn("⚠️ Avertissement Discord.js :", info);
});

// ---------------- Ready ----------------
client.once("clientReady", () => {
  console.log(`✅ ${config.botName} connecté en tant que ${client.user.tag}`);
});

// ---------------- Nouveau membre : rôle non-vérifié + bienvenue ----------------
client.on("guildMemberAdd", async (member) => {
  const unverifiedId = db.getSetting("role:unverified");
  if (unverifiedId) {
    await member.roles.add(unverifiedId).catch(() => {});
  }

  const reglementChanId = db.getSetting("reglement_channel");
  const embed = new EmbedBuilder()
    .setTitle(`👋 Bienvenue sur Stellaria, ${member.user.username} !`)
    .setColor("#F5A623")
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(
      reglementChanId
        ? `☀️ Ravis de t'accueillir sur **Stellaria** !\n\n📜 Consulte <#${reglementChanId}> et réagis avec ✅ pour accéder à l'ensemble du serveur.\n🔗 Pense ensuite à faire \`/link <pseudo>\` pour lier ton compte Minecraft.\n🛒 Direction #commandes pour découvrir le Stellaria Shop !`
        : "Bienvenue ! Un administrateur doit encore configurer le serveur avec `/setup`."
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" });

  const annoncesId = db.getSetting("channel:annonces");
  if (annoncesId) {
    const chan = await member.guild.channels.fetch(annoncesId).catch(() => null);
    if (chan) chan.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(() => {});
  }
});

// ---------------- Rôle réaction sur le règlement ----------------
async function ensureFullReaction(reaction) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return null;
    }
  }
  return reaction;
}

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  reaction = await ensureFullReaction(reaction);
  if (!reaction) return;

  const reglementMsgId = db.getSetting("message:reglement");
  if (!reglementMsgId || reaction.message.id !== reglementMsgId) return;
  if (reaction.emoji.name !== "✅") return;

  const guild = reaction.message.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const unverifiedId = db.getSetting("role:unverified");
  const memberId = db.getSetting("role:member");
  if (memberId) await member.roles.add(memberId).catch(() => {});
  if (unverifiedId) await member.roles.remove(unverifiedId).catch(() => {});
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  reaction = await ensureFullReaction(reaction);
  if (!reaction) return;

  const reglementMsgId = db.getSetting("message:reglement");
  if (!reglementMsgId || reaction.message.id !== reglementMsgId) return;
  if (reaction.emoji.name !== "✅") return;

  const guild = reaction.message.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const unverifiedId = db.getSetting("role:unverified");
  const memberId = db.getSetting("role:member");
  if (memberId) await member.roles.remove(memberId).catch(() => {});
  if (unverifiedId) await member.roles.add(unverifiedId).catch(() => {});
});

// ---------------- Dispatcher d'interactions ----------------
client.on("interactionCreate", async (interaction) => {
  try {
    // ----- Slash commands -----
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }

    // ----- Buttons -----
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === "order_start") { await orders.handleOrderStart(interaction); return; }
      if (id === "banner_order_start") { await handleBannerOrderCommand(interaction); return; }
      if (id === "close_ticket") { await handleCloseTicket(interaction); return; }
      if (id === "reset_confirm") { await require("./reset").handleResetConfirm(interaction); return; }
      if (id === "reset_cancel") { await require("./reset").handleResetCancel(interaction); return; }
      if (id === "dashboard_view") { await orders.handleDashboardButton(interaction); return; }

      if (id.startsWith("propose_price_")) { await orders.handleProposePriceButton(interaction, Number(id.split("_")[2])); return; }
      if (id.startsWith("accept_price_")) { await orders.handleAcceptPrice(interaction, Number(id.split("_")[2])); return; }
      if (id.startsWith("reject_price_")) { await orders.handleRejectPrice(interaction, Number(id.split("_")[2])); return; }

      if (id.startsWith("accept_order_")) { await orders.handleAdminAccept(interaction, Number(id.split("_")[2])); return; }
      if (id.startsWith("decline_order_")) { await orders.handleAdminDeclineButton(interaction, Number(id.split("_")[2])); return; }
      if (id.startsWith("ready_order_")) { await orders.handleMarkReady(interaction, Number(id.split("_")[2])); return; }

      if (id.startsWith("open_ticket_")) { await handleOpenTicket(interaction, Number(id.split("_")[2])); return; }

      if (id.startsWith("suggestion_vote_up_")) { await suggestions.handleVote(interaction, Number(id.split("_").pop()), 1); return; }
      if (id.startsWith("suggestion_vote_down_")) { await suggestions.handleVote(interaction, Number(id.split("_").pop()), -1); return; }
      if (id.startsWith("suggestion_validate_")) { await suggestions.handleStaffDecision(interaction, Number(id.split("_").pop()), "validated"); return; }
      if (id.startsWith("suggestion_reject_")) { await suggestions.handleStaffDecision(interaction, Number(id.split("_").pop()), "rejected"); return; }

      return;
    }

    // ----- Select menus -----
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "order_select_category") { await orders.handleCategorySelect(interaction); return; }
      if (interaction.customId === "order_select_item") { await orders.handleItemSelect(interaction); return; }
      return;
    }

    // ----- Modals -----
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id === "order_modal_custom") { await orders.handleCustomModalSubmit(interaction); return; }
      if (id.startsWith("order_modal_qty_")) { await orders.handleQtyModalSubmit(interaction, id.replace("order_modal_qty_", "")); return; }
      if (id.startsWith("price_modal_")) { await orders.handlePriceModalSubmit(interaction, Number(id.split("_")[2])); return; }
      if (id.startsWith("decline_modal_")) { await orders.handleDeclineModalSubmit(interaction, Number(id.split("_")[2])); return; }

      if (id === "signalement_modal") { await handleReportModalSubmit(interaction); return; }
      if (id === "ticket_autre_modal") { await handleOtherTicketModalSubmit(interaction); return; }
      if (id === "banniere_modal") { await handleBannerOrderModalSubmit(interaction); return; }

      return;
    }
  } catch (err) {
    console.error("❌ Erreur interaction:", err);
    const payload = { content: "❌ Une erreur est survenue. Réessaie, ou préviens le staff si ça persiste.", flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else if (interaction.isRepliable && interaction.isRepliable()) {
        await interaction.reply(payload);
      }
    } catch (followUpErr) {
      console.error("❌ Impossible d'informer l'utilisateur de l'erreur :", followUpErr);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

autoDeployCommands();
