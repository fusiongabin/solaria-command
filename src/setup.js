const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const config = require("../config.json");
const { setSetting, getSetting } = require("./database");

const BRAND_COLOR = "#F5A623";

function brandFooter(guild) {
  return {
    text: `${config.botName} • Stellaria Shop`,
    iconURL: guild.iconURL?.() || undefined,
  };
}

async function findOrCreateRole(guild, name, options = {}) {
  let role = guild.roles.cache.find((r) => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, ...options });
  }
  return role;
}

async function findOrCreateCategory(guild, name) {
  let cat = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );
  if (!cat) {
    cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  }
  return cat;
}

// key = identifiant interne stable (stockage/lookup), displayName = nom réel affiché sur Discord (avec emoji)
async function findOrCreateTextChannel(guild, key, displayName, categoryId, overwrites, topic) {
  const storedId = getSetting(`channel:${key}`);
  let chan = storedId ? await guild.channels.fetch(storedId).catch(() => null) : null;

  if (!chan) {
    chan = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === displayName && c.parentId === categoryId
    );
  }

  if (!chan) {
    chan = await guild.channels.create({
      name: displayName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic,
      permissionOverwrites: overwrites,
    });
  } else {
    if (chan.name !== displayName) await chan.setName(displayName).catch(() => {});
    if (topic && chan.topic !== topic) await chan.setTopic(topic).catch(() => {});
    if (overwrites) await chan.permissionOverwrites.set(overwrites).catch(() => {});
  }

  setSetting(`channel:${key}`, chan.id);
  return chan;
}

// Poste un embed (+ composants éventuels) une seule fois puis le maintient à jour et épinglé.
async function postOrUpdatePinned(channel, settingKey, embed, components, { pin = true, react } = {}) {
  const msgId = getSetting(`message:${settingKey}`);
  let msg = msgId ? await channel.messages.fetch(msgId).catch(() => null) : null;

  const payload = { embeds: [embed], components: components || [] };

  if (msg) {
    await msg.edit(payload);
  } else {
    msg = await channel.send(payload);
    setSetting(`message:${settingKey}`, msg.id);
    if (pin) await msg.pin().catch(() => {});
    if (react) await msg.react(react).catch(() => {});
  }
  return msg;
}

async function runSetup(guild) {
  const everyone = guild.roles.everyone;

  // ---- Roles ----
  const unverifiedRole = await findOrCreateRole(guild, config.roles.unverified, { mentionable: false });
  const memberRole = await findOrCreateRole(guild, config.roles.member, { mentionable: false, color: "Green" });
  const staffRole = await findOrCreateRole(guild, config.roles.staff, { mentionable: true, color: "Red", permissions: [PermissionsBitField.Flags.ManageChannels] });
  const blacklistRole = await findOrCreateRole(guild, config.roles.blacklist, { mentionable: false, color: "DarkGrey" });

  setSetting("role:unverified", unverifiedRole.id);
  setSetting("role:member", memberRole.id);
  setSetting("role:staff", staffRole.id);
  setSetting("role:blacklist", blacklistRole.id);

  // ---- Base overwrites ----
  const publicReadOnlyForUnverified = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: unverifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: memberRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];

  const membersOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: unverifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: memberRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
    { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];

  const membersReadOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: unverifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: memberRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];

  const staffOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: unverifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: memberRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];

  const aideOverwrites = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: unverifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: memberRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
    { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];

  // ================= Informations =================
  const infoCat = await findOrCreateCategory(guild, config.categories.informations.name);

  const reglementChan = await findOrCreateTextChannel(
    guild, "reglement", "📜・règlement", infoCat.id, publicReadOnlyForUnverified,
    "Le règlement de Stellaria — réagis avec ✅ pour accéder au serveur"
  );
  const annoncesChan = await findOrCreateTextChannel(
    guild, "annonces", "📢・annonces", infoCat.id, publicReadOnlyForUnverified,
    "Toutes les annonces officielles de Stellaria"
  );
  const fonctionnementChan = await findOrCreateTextChannel(
    guild, "fonctionnement", "📖・fonctionnement", infoCat.id, publicReadOnlyForUnverified,
    "Comment fonctionne le Stellaria Shop, étape par étape"
  );
  const aideChan = await findOrCreateTextChannel(
    guild, "aide", "❓・aide", infoCat.id, aideOverwrites,
    "Besoin d'aide ? Pose ta question ici ou ouvre un ticket avec /ticket"
  );
  const botCommandesChan = await findOrCreateTextChannel(
    guild, "bot-commandes", "⌨️・bot-commandes", infoCat.id, membersOnly,
    "Le salon dédié pour taper les commandes du bot (/link, /ticket, /suggerer, etc.)"
  );

  // ================= Boutique =================
  const boutiqueCat = await findOrCreateCategory(guild, config.categories.boutique.name);

  const catalogueChan = await findOrCreateTextChannel(
    guild, "catalogue", "🖼️・catalogue", boutiqueCat.id, membersReadOnly,
    "Galerie visuelle des ressources et items disponibles (images postées par le staff)"
  );
  const commandesChan = await findOrCreateTextChannel(
    guild, "commandes", "🛒・commandes", boutiqueCat.id, membersOnly,
    "Passe tes commandes ici via le bouton 🛒 Commander"
  );
  const mesAchatsChan = await findOrCreateTextChannel(
    guild, "mes-achats", "📋・mes-achats", boutiqueCat.id, membersOnly,
    "Ton tableau de bord personnel : pseudo lié et statut de tes commandes"
  );
  const stocksChan = await findOrCreateTextChannel(
    guild, "stocks", "📦・stocks", boutiqueCat.id, membersReadOnly,
    "État des stocks disponibles en jeu, mis à jour par le staff"
  );
  const historiqueChan = await findOrCreateTextChannel(
    guild, "historique-achats", "🧾・historique-achats", boutiqueCat.id, membersReadOnly,
    "Historique de toutes les commandes terminées"
  );

  // ================= Communauté =================
  const commuCat = await findOrCreateCategory(guild, config.categories.communaute.name);

  const suggestionsChan = await findOrCreateTextChannel(
    guild, "suggestions", "💡・suggestions", commuCat.id, membersOnly,
    "Propose tes idées pour améliorer Stellaria"
  );
  const discussionChan = await findOrCreateTextChannel(
    guild, "discussion", "💬・discussion", commuCat.id, membersOnly,
    "Discussion libre entre membres"
  );
  const signalementChan = await findOrCreateTextChannel(
    guild, "signalement", "🐛・signalement", commuCat.id, membersOnly,
    "Signale un bug, un joueur problématique ou une triche"
  );
  const screenshotsChan = await findOrCreateTextChannel(
    guild, "screenshots", "📸・screenshots", commuCat.id, membersOnly,
    "Partage tes plus belles constructions et moments de jeu"
  );

  // ================= Administration (staff only) =================
  // commandes-a-valider : nouvelles commandes à Accepter/Refuser
  // commandes-en-attente : commandes acceptées, en préparation, à marquer "prête"
  // commandes-non-repertoriees : demandes d'items hors catalogue, à chiffrer
  const adminCat = await findOrCreateCategory(guild, config.categories.administration.name);
  await findOrCreateTextChannel(guild, "commandes-a-valider", "🆕・commandes-a-valider", adminCat.id, staffOnly, "Commandes en attente d'acceptation");
  await findOrCreateTextChannel(guild, "commandes-en-attente", "🔨・commandes-en-attente", adminCat.id, staffOnly, "Commandes en préparation, à marquer prêtes");
  await findOrCreateTextChannel(guild, "commandes-non-repertoriees", "📥・commandes-non-repertoriees", adminCat.id, staffOnly, "Demandes hors catalogue, à chiffrer");
  await findOrCreateTextChannel(guild, "logs", "📝・logs", adminCat.id, staffOnly, "Journal des actions du bot");

  // ================= Tickets (4 catégories séparées, salons créés dynamiquement) =================
  const ticketsRecupCat = await findOrCreateCategory(guild, config.categories.ticketsRecuperation.name);
  const ticketsSignalCat = await findOrCreateCategory(guild, config.categories.ticketsSignalement.name);
  const ticketsAutreCat = await findOrCreateCategory(guild, config.categories.ticketsAutre.name);
  const ticketsBanniereCat = await findOrCreateCategory(guild, config.categories.ticketsBanniere.name);
  setSetting("category:tickets-recuperation", ticketsRecupCat.id);
  setSetting("category:tickets-signalement", ticketsSignalCat.id);
  setSetting("category:tickets-autre", ticketsAutreCat.id);
  setSetting("category:tickets-banniere", ticketsBanniereCat.id);

  // ================================================================
  // Embeds
  // ================================================================
  const guildIcon = guild.iconURL?.({ size: 256 }) || null;

  // ---- 📜 Règlement (+ rôle réaction) ----
  const reglementEmbed = new EmbedBuilder()
    .setTitle("📜 Règlement de Stellaria")
    .setDescription(config.reglement)
    .setColor(BRAND_COLOR)
    .setThumbnail(guildIcon)
    .setFooter({ text: "Réagis avec ✅ pour accéder au serveur", iconURL: guildIcon || undefined });
  await postOrUpdatePinned(reglementChan, "reglement", reglementEmbed, [], { react: "✅" });
  setSetting("reglement_channel", reglementChan.id);

  // ---- 📢 Annonces (message d'accueil du salon) ----
  const annoncesEmbed = new EmbedBuilder()
    .setTitle("📢 Bienvenue dans les annonces")
    .setColor(BRAND_COLOR)
    .setDescription(
      "Toutes les news importantes de Stellaria seront postées ici : nouveautés du shop, " +
        "événements, mises à jour du règlement, maintenance, etc.\n\n🔔 Pense à activer les notifications de ce salon !"
    )
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(annoncesChan, "annonces", annoncesEmbed, []);

  // ---- 📖 Fonctionnement (guide complet du shop) ----
  const fonctionnementEmbed = new EmbedBuilder()
    .setTitle("📖 Comment fonctionne le Stellaria Shop")
    .setColor(BRAND_COLOR)
    .setThumbnail(guildIcon)
    .setDescription(
      "Voici comment commander tes ressources sur Stellaria, étape par étape :"
    )
    .addFields(
      { name: "1️⃣ Lie ton pseudo", value: "Utilise `/link <pseudo>` pour relier ton compte Discord à ton pseudo Minecraft." },
      { name: "2️⃣ Consulte le catalogue", value: `Jette un œil aux visuels dans <#${catalogueChan.id}> pour voir ce qui est disponible.` },
      { name: "3️⃣ Commande", value: `Rends-toi dans <#${commandesChan.id}>, clique **🛒 Commander**, choisis une catégorie puis ta ressource et la quantité. Le prix est calculé automatiquement.` },
      { name: "4️⃣ Item non répertorié ?", value: "Choisis **Autre**, décris ta demande, le staff te proposera un prix en MP." },
      { name: "🎨 Bannière personnalisée", value: `Clique **🎨 Commande de bannière Minecraft** dans <#${commandesChan.id}> : décris ta bannière, un ticket dédié s'ouvre avec le staff.` },
      { name: "5️⃣ Validation", value: "Le staff accepte ou refuse ta commande. Tu es prévenu par message privé à chaque étape." },
      { name: "6️⃣ Préparation", value: "Une fois acceptée, ta commande est préparée en jeu par le staff." },
      { name: "7️⃣ Récupération", value: "Quand c'est prêt, tu reçois un MP avec un bouton **🎫 Ouvrir un ticket** pour venir récupérer tes ressources." },
      { name: "📋 Suivi", value: `Utilise \`/mes-commandes\` ou le bouton dans <#${mesAchatsChan.id}> pour voir le statut de tes commandes à tout moment.` },
      { name: "🚨 Signaler un problème", value: "Utilise `/signaler` : un formulaire s'ouvre, puis un ticket privé se crée avec le staff." },
      { name: "📩 Autre demande", value: "Utilise `/ticket` : un petit formulaire s'ouvre, puis un ticket privé se crée avec le staff." },
      { name: "💡 Proposer une idée", value: "Utilise `/suggerer <idée>` : la communauté vote pour ou contre, puis le staff valide ou refuse." }
    )
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(fonctionnementChan, "fonctionnement", fonctionnementEmbed, []);

  // ---- ❓ Aide (FAQ enrichie) ----
  const aideEmbed = new EmbedBuilder()
    .setTitle("❓ Besoin d'aide ?")
    .setColor(BRAND_COLOR)
    .setThumbnail(guildIcon)
    .setDescription("Voici les situations les plus fréquentes et comment les résoudre. Si tu ne trouves pas ta réponse, pose ta question dans ce salon.")
    .addFields(
      { name: "🔗 Je n'arrive pas à commander", value: "Vérifie que tu as bien fait `/link <pseudo>` et que tu n'es pas blacklist." },
      { name: "📦 Où en est ma commande ?", value: `Utilise \`/mes-commandes\` ou le tableau de bord dans <#${mesAchatsChan.id}>.` },
      { name: "💰 Le prix ne me convient pas", value: "Pour un item hors catalogue, tu peux refuser l'offre proposée par le staff." },
      { name: "🎫 Comment récupérer ma commande ?", value: "Un bouton **Ouvrir un ticket** t'est envoyé en MP dès qu'elle est prête." },
      { name: "🚨 Je veux signaler un joueur ou un problème", value: "Utilise `/signaler`, remplis le formulaire, un ticket privé s'ouvre avec le staff." },
      { name: "📩 J'ai une autre question pour le staff", value: "Utilise `/ticket`, remplis le petit formulaire, un ticket privé s'ouvre." },
      { name: "💡 J'ai une idée d'amélioration", value: "Utilise `/suggerer <ton idée>` dans #suggestions : la communauté vote, puis le staff décide." },
      { name: "⌨️ Je ne connais pas toutes les commandes", value: `Tape \`/aide\` n'importe où, ou va dans <#${botCommandesChan.id}> pour la liste complète.` },
      { name: "🔇 Je ne sais pas où taper les commandes du bot", value: `Rends-toi dans <#${botCommandesChan.id}>, c'est le salon dédié à ça.` }
    )
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(aideChan, "aide", aideEmbed, []);

  // ---- ⌨️ Bot-commandes (liste complète des commandes) ----
  const { buildHelpEmbed } = require("./help");
  const helpEmbed = buildHelpEmbed(false);
  helpEmbed.setThumbnail(guildIcon);
  await postOrUpdatePinned(botCommandesChan, "bot-commandes", helpEmbed, []);

  // ---- 🖼️ Catalogue (rappel d'usage, les images sont postées manuellement) ----
  const catalogueEmbed = new EmbedBuilder()
    .setTitle("🖼️ Catalogue Stellaria")
    .setColor(BRAND_COLOR)
    .setDescription(
      `Ce salon est une **galerie visuelle** : le staff y poste des images/aperçus des ressources et items disponibles.\n\n` +
        `➡️ Pour **passer commande**, rends-toi dans <#${commandesChan.id}> et clique sur **🛒 Commander** — les prix y sont calculés automatiquement.`
    )
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(catalogueChan, "catalogue-info", catalogueEmbed, []);

  // ---- 🛒 Commandes (bouton Commander + bouton Bannière) ----
  const commandesEmbed = new EmbedBuilder()
    .setTitle("🛒 Passer une commande")
    .setColor(BRAND_COLOR)
    .setThumbnail(guildIcon)
    .setDescription(
      "Clique sur **🛒 Commander** pour commander une ressource du catalogue.\n" +
        "Tu dois être lié avec `/link <pseudo>` pour pouvoir commander.\n\n" +
        "Tu veux une **bannière Minecraft personnalisée** ? Clique sur **🎨 Commande de bannière Minecraft** " +
        "pour ouvrir un ticket dédié où tu pourras décrire ce que tu veux."
    )
    .addFields({ name: "💰 Devise", value: config.devise, inline: true })
    .setFooter(brandFooter(guild));
  const commandesRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("order_start").setLabel("Commander").setEmoji("🛒").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("banner_order_start").setLabel("Commande de bannière Minecraft").setEmoji("🎨").setStyle(ButtonStyle.Secondary)
  );
  await postOrUpdatePinned(commandesChan, "commandes", commandesEmbed, [commandesRow]);

  // ---- 📋 Mes-achats (tableau de bord personnel) ----
  const dashboardEmbed = new EmbedBuilder()
    .setTitle("📋 Mon tableau de bord")
    .setColor(BRAND_COLOR)
    .setThumbnail(guildIcon)
    .setDescription(
      "Clique sur le bouton ci-dessous pour voir **tes** infos en direct : ton pseudo lié et le statut de tes commandes en cours.\n" +
        "🔒 Seul toi peux voir la réponse."
    )
    .setFooter(brandFooter(guild));
  const dashboardRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("dashboard_view").setLabel("Voir mon tableau de bord").setEmoji("📋").setStyle(ButtonStyle.Primary)
  );
  await postOrUpdatePinned(mesAchatsChan, "mes-achats", dashboardEmbed, [dashboardRow]);

  // ---- 📦 Stocks (rappel d'usage) ----
  const stocksEmbed = new EmbedBuilder()
    .setTitle("📦 Stocks disponibles")
    .setColor(BRAND_COLOR)
    .setDescription("Le staff tient ce salon à jour avec les ressources actuellement disponibles en jeu.")
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(stocksChan, "stocks", stocksEmbed, []);

  // ---- 🧾 Historique (en-tête, les entrées sont ajoutées automatiquement) ----
  const historiqueEmbed = new EmbedBuilder()
    .setTitle("🧾 Historique des achats")
    .setColor(BRAND_COLOR)
    .setDescription("Chaque commande terminée (ticket clôturé) apparaît automatiquement ci-dessous. ⬇️")
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(historiqueChan, "historique-achats", historiqueEmbed, []);

  // ---- 💡 Suggestions ----
  const suggestionsEmbed = new EmbedBuilder()
    .setTitle("💡 Boîte à idées")
    .setColor(BRAND_COLOR)
    .setDescription(
      "Une idée pour améliorer le shop, le serveur ou la communauté ?\n\n" +
        "➡️ Utilise **`/suggerer <ton idée>`**. Ta suggestion est postée ici avec des boutons **👍 Pour / 👎 Contre** : " +
        "toute la communauté peut voter ! Le staff regarde ensuite les votes et décide de **✅ Valider** ou **❌ Refuser** la suggestion."
    )
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(suggestionsChan, "suggestions", suggestionsEmbed, []);

  // ---- 💬 Discussion ----
  const discussionEmbed = new EmbedBuilder()
    .setTitle("💬 Discussion libre")
    .setColor(BRAND_COLOR)
    .setDescription("Le salon pour discuter de tout et de rien avec la communauté de Stellaria. Reste respectueux ! 😊")
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(discussionChan, "discussion", discussionEmbed, []);

  // ---- 🐛 Signalement ----
  const signalementEmbed = new EmbedBuilder()
    .setTitle("🐛 Signaler un problème")
    .setColor(BRAND_COLOR)
    .setDescription(
      "Bug, triche, comportement suspect, litige avec un autre joueur ?\n\n" +
        "➡️ Utilise la commande **`/signaler`** : un formulaire s'ouvre (ton pseudo en jeu, le joueur/la situation concernée, une description détaillée), " +
        "puis un **ticket privé** est automatiquement créé avec le staff pour traiter ta demande."
    )
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(signalementChan, "signalement", signalementEmbed, []);

  // ---- 📸 Screenshots ----
  const screenshotsEmbed = new EmbedBuilder()
    .setTitle("📸 Vos plus belles captures")
    .setColor(BRAND_COLOR)
    .setDescription("Partage tes constructions, paysages et moments marquants sur Stellaria !")
    .setFooter(brandFooter(guild));
  await postOrUpdatePinned(screenshotsChan, "screenshots", screenshotsEmbed, []);

  return { unverifiedRole, memberRole, staffRole, blacklistRole };
}

module.exports = { runSetup };
