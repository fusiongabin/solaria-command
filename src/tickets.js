const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const config = require("../config.json");
const db = require("./database");
const { isStaff, getGuildChannel, dmUser } = require("./orders");

async function handleOpenTicket(interaction, orderId) {
  const guildId = process.env.GUILD_ID;
  const guild = interaction.guild || interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    return interaction.reply({ content: "❌ Impossible de trouver le serveur.", ephemeral: true });
  }

  const existing = db.getOpenTicketByUser(interaction.user.id);
  if (existing) {
    return interaction.reply({
      content: `⚠️ Tu as déjà un ticket ouvert : <#${existing.channel_id}>`,
      ephemeral: true,
    });
  }

  const order = orderId ? db.getOrder(orderId) : null;
  const staffRoleId = db.getSetting("role:staff");
  const ticketsCategoryId = db.getSetting("category:tickets");

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return interaction.reply({ content: "❌ Tu dois être membre du serveur pour ouvrir un ticket.", ephemeral: true });
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];
  if (staffRoleId) {
    overwrites.push({ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
  }

  const channel = await guild.channels.create({
    name: `ticket-${member.user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    parent: ticketsCategoryId || undefined,
    permissionOverwrites: overwrites,
  });

  db.createTicket(channel.id, interaction.user.id, orderId || null);

  const embed = new EmbedBuilder()
    .setTitle("🎫 Ticket de récupération")
    .setColor("Blue")
    .setDescription(
      order
        ? `Bienvenue <@${member.id}> !\n\n**Commande #${order.id}**\nRessource : **${order.quantity}x ${order.item}**\nPrix : **${order.total_price ?? "N/A"} ${config.devise}**\n\nUn membre du staff va venir te livrer en jeu. Merci de préciser ta disponibilité.`
        : `Bienvenue <@${member.id}> ! Explique ta demande, un membre du staff va te répondre.`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Clôturer le ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${member.id}>${staffRoleId ? ` <@&${staffRoleId}>` : ""}`,
    embeds: [embed],
    components: [row],
  });

  const replyPayload = { content: `✅ Ton ticket a été créé : <#${channel.id}>`, ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(replyPayload).catch(() => {});
  } else if (interaction.isButton && interaction.isButton() && interaction.message?.flags?.has?.("Ephemeral")) {
    await interaction.reply(replyPayload);
  } else {
    // interaction came from a DM component — update the DM message instead
    try {
      await interaction.update({ content: `✅ Ton ticket a été créé : <#${channel.id}>`, embeds: [], components: [] });
    } catch {
      await interaction.reply(replyPayload).catch(() => {});
    }
  }
}

async function handleCloseTicket(interaction) {
  const ticket = db.getTicket(interaction.channel.id);
  const member = interaction.member;
  const isOwner = ticket && ticket.discord_id === interaction.user.id;

  if (!isStaff(member) && !isOwner) {
    return interaction.reply({ content: "❌ Tu ne peux pas clôturer ce ticket.", ephemeral: true });
  }

  await interaction.reply({ content: "🔒 Ticket clôturé, ce salon sera supprimé dans 10 secondes." });
  db.closeTicket(interaction.channel.id);

  if (ticket?.order_id) {
    db.updateOrder(ticket.order_id, { status: "completed" });
    const order = db.getOrder(ticket.order_id);
    const histChan = await getGuildChannel(interaction.guild, "historique-achats");
    if (histChan && order) {
      const embed = new EmbedBuilder()
        .setTitle(`✅ Commande #${order.id} terminée`)
        .setColor("Green")
        .addFields(
          { name: "Joueur", value: `${order.ign}`, inline: true },
          { name: "Ressource", value: order.item, inline: true },
          { name: "Quantité", value: String(order.quantity), inline: true },
          { name: "Prix total", value: order.total_price != null ? `${order.total_price} ${config.devise}` : "N/A", inline: true }
        )
        .setTimestamp();
      await histChan.send({ embeds: [embed] });
    }
  }

  const logsChan = await getGuildChannel(interaction.guild, "logs");
  if (logsChan) {
    await logsChan.send(`🔒 Ticket **${interaction.channel.name}** clôturé par ${interaction.user.tag}.`);
  }

  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, 10000);
}

module.exports = { handleOpenTicket, handleCloseTicket };
