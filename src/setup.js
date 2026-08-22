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

async function findOrCreateTextChannel(guild, name, categoryId, overwrites) {
  let chan = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === name && c.parentId === categoryId
  );
  if (!chan) {
    chan = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites,
    });
  } else if (overwrites) {
    await chan.permissionOverwrites.set(overwrites);
  }
  setSetting(`channel:${name}`, chan.id);
  return chan;
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

  // ---- Informations ----
  const infoCat = await findOrCreateCategory(guild, config.categories.informations.name);
  const reglementChan = await findOrCreateTextChannel(guild, "règlement", infoCat.id, publicReadOnlyForUnverified);
  await findOrCreateTextChannel(guild, "annonces", infoCat.id, publicReadOnlyForUnverified);
  await findOrCreateTextChannel(guild, "fonctionnement", infoCat.id, publicReadOnlyForUnverified);
  await findOrCreateTextChannel(guild, "aide", infoCat.id, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: unverifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: memberRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
    { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ]);

  // ---- Boutique ----
  // #catalogue est une galerie d'images postées manuellement par le staff (pas géré par le bot).
  const boutiqueCat = await findOrCreateCategory(guild, config.categories.boutique.name);
  await findOrCreateTextChannel(guild, "catalogue", boutiqueCat.id, membersReadOnly);
  const commandesChan = await findOrCreateTextChannel(guild, "commandes", boutiqueCat.id, membersOnly);
  await findOrCreateTextChannel(guild, "stocks", boutiqueCat.id, membersReadOnly);
  await findOrCreateTextChannel(guild, "historique-achats", boutiqueCat.id, membersReadOnly);

  // ---- Communauté ----
  const commuCat = await findOrCreateCategory(guild, config.categories.communaute.name);
  await findOrCreateTextChannel(guild, "suggestions", commuCat.id, membersOnly);
  await findOrCreateTextChannel(guild, "discussion", commuCat.id, membersOnly);
  await findOrCreateTextChannel(guild, "signalement", commuCat.id, membersOnly);
  await findOrCreateTextChannel(guild, "screenshots", commuCat.id, membersOnly);

  // ---- Administration (staff only) ----
  // commandes-a-valider : nouvelles commandes à Accepter/Refuser
  // commandes-en-attente : commandes acceptées, en préparation, à marquer "prête"
  // commandes-non-repertoriees : demandes d'items hors catalogue, à chiffrer
  const adminCat = await findOrCreateCategory(guild, config.categories.administration.name);
  await findOrCreateTextChannel(guild, "commandes-a-valider", adminCat.id, staffOnly);
  await findOrCreateTextChannel(guild, "commandes-en-attente", adminCat.id, staffOnly);
  await findOrCreateTextChannel(guild, "commandes-non-repertoriees", adminCat.id, staffOnly);
  await findOrCreateTextChannel(guild, "logs", adminCat.id, staffOnly);

  // ---- Tickets category (channels created dynamically, but keep the category) ----
  const ticketsCat = await findOrCreateCategory(guild, config.categories.tickets.name);
  setSetting("category:tickets", ticketsCat.id);

  // ---- Post rules embed with reaction role ----
  const reglementEmbed = new EmbedBuilder()
    .setTitle("📜 Règlement de Solaria")
    .setDescription(config.reglement)
    .setColor("Gold")
    .setFooter({ text: "Réagis avec ✅ pour accéder au serveur" });

  let reglementMsgId = getSetting("message:reglement");
  let reglementMsg;
  if (reglementMsgId) {
    try {
      reglementMsg = await reglementChan.messages.fetch(reglementMsgId);
      await reglementMsg.edit({ embeds: [reglementEmbed] });
    } catch {
      reglementMsg = null;
    }
  }
  if (!reglementMsg) {
    reglementMsg = await reglementChan.send({ embeds: [reglementEmbed] });
    await reglementMsg.react("✅");
    setSetting("message:reglement", reglementMsg.id);
  }
  setSetting("reglement_channel", reglementChan.id);

  // ---- Post commandes embed with "Commander" button ----
  const commandesEmbed = new EmbedBuilder()
    .setTitle("🛒 Passer une commande")
    .setDescription(
      "Clique sur le bouton ci-dessous pour commander une ressource.\nTu dois être lié avec `/link <pseudo>` pour pouvoir commander."
    )
    .setColor("Blue");
  const commandesRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("order_start").setLabel("Commander").setEmoji("🛒").setStyle(ButtonStyle.Primary)
  );

  let commandesMsgId = getSetting("message:commandes");
  let commandesMsg;
  if (commandesMsgId) {
    try {
      commandesMsg = await commandesChan.messages.fetch(commandesMsgId);
      await commandesMsg.edit({ embeds: [commandesEmbed], components: [commandesRow] });
    } catch {
      commandesMsg = null;
    }
  }
  if (!commandesMsg) {
    commandesMsg = await commandesChan.send({ embeds: [commandesEmbed], components: [commandesRow] });
    setSetting("message:commandes", commandesMsg.id);
  }

  return {
    unverifiedRole,
    memberRole,
    staffRole,
    blacklistRole,
  };
}

module.exports = { runSetup };
