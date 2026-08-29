const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const config = require("../config.json");
const db = require("./database");
const { isStaff, getGuildChannel, getItemEmoji } = require("./orders");

const TICKET_TYPES = {
  recuperation: { categoryKey: "category:tickets-recuperation", emoji: "🎫", label: "Récupération", color: "#3498DB" },
  signalement: { categoryKey: "category:tickets-signalement", emoji: "🚨", label: "Signalement", color: "#E74C3C" },
  autre: { categoryKey: "category:tickets-autre", emoji: "📩", label: "Autre", color: "#9B59B6" },
  banniere: { categoryKey: "category:tickets-banniere", emoji: "🎨", label: "Bannière Minecraft", color: "#E91E63" },
};

// ---------- Ouverture d'un ticket (les 3 types passent par ici) ----------
async function handleOpenTicket(interaction, orderId, type = "recuperation", extraFields = []) {
  const meta = TICKET_TYPES[type] || TICKET_TYPES.recuperation;
  const guildId = process.env.GUILD_ID;
  const guild = interaction.guild || interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    return interaction.reply({ content: "❌ Impossible de trouver le serveur.", flags: MessageFlags.Ephemeral });
  }

  const existing = db.getOpenTicketByUser(interaction.user.id, type);
  if (existing) {
    const payload = { content: `⚠️ Tu as déjà un ticket ${meta.label} ouvert : <#${existing.channel_id}>`, flags: MessageFlags.Ephemeral };
    return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
  }

  const staffRoleId = db.getSetting("role:staff");
  const categoryId = db.getSetting(meta.categoryKey);

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    const payload = { content: "❌ Tu dois être membre du serveur pour ouvrir un ticket.", flags: MessageFlags.Ephemeral };
    return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];
  if (staffRoleId) {
    overwrites.push({ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
  }

  const channel = await guild.channels.create({
    name: `${meta.emoji}-${member.user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    permissionOverwrites: overwrites,
  });

  db.createTicket(channel.id, interaction.user.id, orderId || null, type);

  const order = orderId ? db.getOrder(orderId) : null;

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} Ticket ${meta.label}`)
    .setColor(meta.color)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: "Stellaria Command • Stellaria Shop" })
    .setTimestamp();

  if (type === "recuperation" && order) {
    embed.setDescription(
      `👋 Bienvenue <@${member.id}> !\n\n🧾 **Commande #${order.id}**\n${getItemEmoji(order.item)} Ressource : **${order.quantity}x ${order.item}**\n💰 Prix : **${order.total_price ?? "N/A"} ${config.devise}**\n\nUn membre du staff va venir te livrer en jeu. Merci de préciser ta disponibilité. 🕒`
    );
  } else {
    embed.setDescription(`👋 Bienvenue <@${member.id}> ! Un membre du staff va prendre en charge ta demande.`);
    if (extraFields.length) embed.addFields(...extraFields);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Clôturer le ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${member.id}>${staffRoleId ? ` <@&${staffRoleId}>` : ""}`,
    embeds: [embed],
    components: [row],
  });

  const replyPayload = { content: `✅ Ton ticket ${meta.label} a été créé : <#${channel.id}>`, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(replyPayload).catch(() => {});
  } else {
    try {
      await interaction.reply(replyPayload);
    } catch {
      await interaction.update({ content: `✅ Ton ticket a été créé : <#${channel.id}>`, embeds: [], components: [] }).catch(() => {});
    }
  }
}

// ---------- /signaler : ouvre le modal de signalement ----------
async function handleReportCommand(interaction) {
  const modal = new ModalBuilder().setCustomId("signalement_modal").setTitle("🚨 Signaler un problème");

  const ignInput = new TextInputBuilder()
    .setCustomId("report_ign")
    .setLabel("Ton pseudo en jeu")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const targetInput = new TextInputBuilder()
    .setCustomId("report_target")
    .setLabel("Joueur / situation concernée")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const descInput = new TextInputBuilder()
    .setCustomId("report_description")
    .setLabel("Décris le problème en détail")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(ignInput),
    new ActionRowBuilder().addComponents(targetInput),
    new ActionRowBuilder().addComponents(descInput)
  );
  return interaction.showModal(modal);
}

async function handleReportModalSubmit(interaction) {
  const ign = interaction.fields.getTextInputValue("report_ign");
  const target = interaction.fields.getTextInputValue("report_target");
  const description = interaction.fields.getTextInputValue("report_description");

  await handleOpenTicket(interaction, null, "signalement", [
    { name: "🎮 Pseudo en jeu du signaleur", value: ign, inline: true },
    { name: "🎯 Concerné", value: target, inline: true },
    { name: "📝 Description", value: description },
  ]);
}

// ---------- /ticket : ouvre le modal "ticket autre" ----------
async function handleOtherTicketCommand(interaction) {
  const modal = new ModalBuilder().setCustomId("ticket_autre_modal").setTitle("📩 Ouvrir un ticket");

  const subjectInput = new TextInputBuilder()
    .setCustomId("ticket_subject")
    .setLabel("Sujet de ta demande")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const descInput = new TextInputBuilder()
    .setCustomId("ticket_description")
    .setLabel("Décris ta demande")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(descInput)
  );
  return interaction.showModal(modal);
}

async function handleOtherTicketModalSubmit(interaction) {
  const subject = interaction.fields.getTextInputValue("ticket_subject");
  const description = interaction.fields.getTextInputValue("ticket_description");

  await handleOpenTicket(interaction, null, "autre", [
    { name: "📌 Sujet", value: subject },
    { name: "📝 Description", value: description },
  ]);
}

// ---------- Bouton "Commande de bannière Minecraft" : ouvre le modal ----------
async function handleBannerOrderCommand(interaction) {
  const modal = new ModalBuilder().setCustomId("banniere_modal").setTitle("🎨 Commande de bannière Minecraft");

  const descInput = new TextInputBuilder()
    .setCustomId("banniere_description")
    .setLabel("Décris la bannière que tu veux")
    .setPlaceholder("Motif, couleurs, style, référence...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);
  const qtyInput = new TextInputBuilder()
    .setCustomId("banniere_qty")
    .setLabel("Nombre de bannières souhaitées")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue("1");

  modal.addComponents(
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(qtyInput)
  );
  return interaction.showModal(modal);
}

async function handleBannerOrderModalSubmit(interaction) {
  const description = interaction.fields.getTextInputValue("banniere_description");
  const qty = interaction.fields.getTextInputValue("banniere_qty");

  await handleOpenTicket(interaction, null, "banniere", [
    { name: "🎨 Description de la bannière", value: description },
    { name: "🔢 Quantité", value: qty, inline: true },
  ]);
}

// ---------- Clôture d'un ticket (tous types) ----------
async function handleCloseTicket(interaction) {
  const ticket = db.getTicket(interaction.channel.id);
  const member = interaction.member;
  const isOwner = ticket && ticket.discord_id === interaction.user.id;

  if (!isStaff(member) && !isOwner) {
    return interaction.reply({ content: "❌ Tu ne peux pas clôturer ce ticket.", flags: MessageFlags.Ephemeral });
  }

  const meta = TICKET_TYPES[ticket?.type] || TICKET_TYPES.recuperation;

  await interaction.reply({ content: `🔒 Ticket ${meta.label} clôturé, ce salon sera supprimé dans 10 secondes. Merci et à bientôt sur Stellaria ! 👋` });
  db.closeTicket(interaction.channel.id);

  if (ticket?.order_id) {
    db.updateOrder(ticket.order_id, { status: "completed" });
    const order = db.getOrder(ticket.order_id);
    const histChan = await getGuildChannel(interaction.guild, "historique-achats");
    if (histChan && order) {
      const embed = new EmbedBuilder()
        .setTitle(`✅ Commande #${order.id} terminée`)
        .setColor("#2ECC71")
        .addFields(
          { name: "🎮 Joueur", value: `${order.ign}`, inline: true },
          { name: `${getItemEmoji(order.item)} Ressource`, value: order.item, inline: true },
          { name: "🔢 Quantité", value: String(order.quantity), inline: true },
          { name: "💰 Prix total", value: order.total_price != null ? `${order.total_price} ${config.devise}` : "N/A", inline: true }
        )
        .setFooter({ text: "Stellaria Command • Stellaria Shop" })
        .setTimestamp();
      await histChan.send({ embeds: [embed] });
    }
  }

  const logsChan = await getGuildChannel(interaction.guild, "logs");
  if (logsChan) {
    await logsChan.send(`🔒📁 Ticket ${meta.label} **${interaction.channel.name}** clôturé par **${interaction.user.tag}**.`);
  }

  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, 10000);
}

module.exports = {
  TICKET_TYPES,
  handleOpenTicket,
  handleCloseTicket,
  handleReportCommand,
  handleReportModalSubmit,
  handleOtherTicketCommand,
  handleOtherTicketModalSubmit,
  handleBannerOrderCommand,
  handleBannerOrderModalSubmit,
};
