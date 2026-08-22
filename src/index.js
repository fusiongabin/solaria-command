require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
} = require("discord.js");
const config = require("../config.json");
const db = require("./database");
const commandList = require("./commands");
const orders = require("./orders");
const { handleOpenTicket, handleCloseTicket } = require("./tickets");

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
    .setTitle(`👋 Bienvenue sur Solaria, ${member.user.username} !`)
    .setColor("Gold")
    .setDescription(
      reglementChanId
        ? `Consulte <#${reglementChanId}> et réagis avec ✅ pour accéder à l'ensemble du serveur.\nPense ensuite à faire \`/link <pseudo>\` pour lier ton compte Minecraft.`
        : "Bienvenue ! Un administrateur doit encore configurer le serveur avec `/setup`."
    );

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
      return cmd.execute(interaction);
    }

    // ----- Buttons -----
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === "order_start") return orders.handleOrderStart(interaction);
      if (id === "close_ticket") return handleCloseTicket(interaction);

      if (id.startsWith("propose_price_")) return orders.handleProposePriceButton(interaction, Number(id.split("_")[2]));
      if (id.startsWith("accept_price_")) return orders.handleAcceptPrice(interaction, Number(id.split("_")[2]));
      if (id.startsWith("reject_price_")) return orders.handleRejectPrice(interaction, Number(id.split("_")[2]));

      if (id.startsWith("accept_order_")) return orders.handleAdminAccept(interaction, Number(id.split("_")[2]));
      if (id.startsWith("decline_order_")) return orders.handleAdminDeclineButton(interaction, Number(id.split("_")[2]));
      if (id.startsWith("ready_order_")) return orders.handleMarkReady(interaction, Number(id.split("_")[2]));

      if (id.startsWith("open_ticket_")) return handleOpenTicket(interaction, Number(id.split("_")[2]));

      return;
    }

    // ----- Select menus -----
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "order_select_item") return orders.handleItemSelect(interaction);
      return;
    }

    // ----- Modals -----
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id === "order_modal_custom") return orders.handleCustomModalSubmit(interaction);
      if (id.startsWith("order_modal_qty_")) return orders.handleQtyModalSubmit(interaction, id.replace("order_modal_qty_", ""));
      if (id.startsWith("price_modal_")) return orders.handlePriceModalSubmit(interaction, Number(id.split("_")[2]));
      if (id.startsWith("decline_modal_")) return orders.handleDeclineModalSubmit(interaction, Number(id.split("_")[2]));

      return;
    }
  } catch (err) {
    console.error("Erreur interaction:", err);
    const payload = { content: "❌ Une erreur est survenue.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else if (interaction.isRepliable && interaction.isRepliable()) {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
