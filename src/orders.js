const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const config = require("../config.json");
const db = require("./database");

function isStaff(member) {
  const staffId = db.getSetting("role:staff");
  return staffId ? member.roles.cache.has(staffId) : member.permissions.has("ManageGuild");
}

async function getGuildChannel(guild, key) {
  const id = db.getSetting(`channel:${key}`);
  if (!id) return null;
  return guild.channels.fetch(id).catch(() => null);
}

async function dmUser(client, discordId, payload) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

// ---------- Step 1: bouton "Commander" ----------
async function handleOrderStart(interaction) {
  const link = db.getLink(interaction.user.id);
  if (!link) {
    return interaction.reply({
      content: "❌ Tu dois d'abord lier ton compte avec `/link <pseudo>` avant de commander.",
      ephemeral: true,
    });
  }
  if (db.isBlacklisted(interaction.user.id)) {
    return interaction.reply({
      content: "🚫 Tu es blacklist et tu ne peux pas passer de commande. Contacte le staff dans #aide.",
      ephemeral: true,
    });
  }

  const items = db.listCatalog();
  const options = items.slice(0, 24).map((i) => ({
    label: i.item,
    description: `${i.unit_qty} unité(s) = ${i.unit_price} ${config.devise}`,
    value: i.item,
  }));
  options.push({
    label: "Autre (non répertorié)",
    description: "La ressource n'est pas dans le catalogue",
    value: "__custom__",
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("order_select_item")
    .setPlaceholder("Choisis une ressource")
    .addOptions(options);

  await interaction.reply({
    content: `🛒 Sélectionne la ressource que tu veux commander, ${link.ign} :`,
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

// ---------- Step 2: sélection d'un item ----------
async function handleItemSelect(interaction) {
  const value = interaction.values[0];

  if (value === "__custom__") {
    const modal = new ModalBuilder().setCustomId("order_modal_custom").setTitle("Commande non répertoriée");
    const nameInput = new TextInputBuilder()
      .setCustomId("item_name")
      .setLabel("Nom de la ressource souhaitée")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const qtyInput = new TextInputBuilder()
      .setCustomId("item_qty")
      .setLabel("Quantité souhaitée")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(qtyInput)
    );
    return interaction.showModal(modal);
  }

  const modal = new ModalBuilder()
    .setCustomId(`order_modal_qty_${value}`)
    .setTitle(`Commande : ${value}`);
  const qtyInput = new TextInputBuilder()
    .setCustomId("item_qty")
    .setLabel("Quantité souhaitée")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
  return interaction.showModal(modal);
}

// ---------- Step 3a: modal quantité pour un item du catalogue ----------
async function handleQtyModalSubmit(interaction, itemName) {
  const link = db.getLink(interaction.user.id);
  if (!link) {
    return interaction.reply({ content: "❌ Tu dois d'abord `/link` ton pseudo.", ephemeral: true });
  }

  const qtyRaw = interaction.fields.getTextInputValue("item_qty");
  const qty = parseInt(qtyRaw, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return interaction.reply({ content: "❌ Quantité invalide.", ephemeral: true });
  }

  const catalogItem = db.getCatalogItem(itemName);
  if (!catalogItem) {
    return interaction.reply({ content: "❌ Cet item n'existe plus dans le catalogue.", ephemeral: true });
  }

  const totalPrice = Math.round((qty / catalogItem.unit_qty) * catalogItem.unit_price * 100) / 100;

  const orderId = db.createOrder({
    discordId: interaction.user.id,
    ign: link.ign,
    item: catalogItem.item,
    quantity: qty,
    totalPrice,
    status: "pending_review",
    isCustom: false,
  });

  await interaction.reply({
    content: `✅ Ta commande de **${qty} ${catalogItem.item}** (${totalPrice} ${config.devise}) a été envoyée au staff. Tu recevras un message privé dès qu'elle sera traitée.`,
    ephemeral: true,
  });

  await postOrderToAdmin(interaction.client, interaction.guild, orderId);
}

// ---------- Step 3b: modal pour un item non répertorié ----------
async function handleCustomModalSubmit(interaction) {
  const link = db.getLink(interaction.user.id);
  if (!link) {
    return interaction.reply({ content: "❌ Tu dois d'abord `/link` ton pseudo.", ephemeral: true });
  }

  const itemName = interaction.fields.getTextInputValue("item_name").trim();
  const qtyRaw = interaction.fields.getTextInputValue("item_qty");
  const qty = parseInt(qtyRaw, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return interaction.reply({ content: "❌ Quantité invalide.", ephemeral: true });
  }

  const orderId = db.createOrder({
    discordId: interaction.user.id,
    ign: link.ign,
    item: itemName,
    quantity: qty,
    totalPrice: null,
    status: "unlisted_review",
    isCustom: true,
  });

  await interaction.reply({
    content: `✅ Ta demande pour **${qty}x ${itemName}** a été transmise au staff, qui va te proposer un prix. Tu recevras un message privé.`,
    ephemeral: true,
  });

  const chan = await getGuildChannel(interaction.guild, "commandes-non-repertoriees");
  if (!chan) return;

  const embed = new EmbedBuilder()
    .setTitle(`📥 Commande non répertoriée #${orderId}`)
    .setColor("Orange")
    .addFields(
      { name: "Joueur", value: `<@${interaction.user.id}> (${link.ign})`, inline: true },
      { name: "Ressource", value: itemName, inline: true },
      { name: "Quantité", value: String(qty), inline: true }
    )
    .setFooter({ text: "Clique sur 'Proposer un prix' pour envoyer une offre au joueur." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`propose_price_${orderId}`)
      .setLabel("Proposer un prix")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await chan.send({ embeds: [embed], components: [row] });
  db.updateOrder(orderId, { admin_channel_id: chan.id, admin_message_id: msg.id });
}

// ---------- Staff : proposer un prix pour une commande non répertoriée ----------
async function handleProposePriceButton(interaction, orderId) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId(`price_modal_${orderId}`).setTitle("Proposer un prix");
  const priceInput = new TextInputBuilder()
    .setCustomId("price_value")
    .setLabel(`Prix total (${config.devise})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(priceInput));
  return interaction.showModal(modal);
}

async function handlePriceModalSubmit(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", ephemeral: true });

  const priceRaw = interaction.fields.getTextInputValue("price_value");
  const price = parseFloat(priceRaw.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    return interaction.reply({ content: "❌ Prix invalide.", ephemeral: true });
  }

  db.updateOrder(orderId, { total_price: price });

  await interaction.reply({ content: `✅ Prix de ${price} ${config.devise} envoyé à ${order.ign}.`, ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle("💰 Offre de prix pour ta commande")
    .setColor("Gold")
    .setDescription(
      `Le staff propose **${price} ${config.devise}** pour **${order.quantity}x ${order.item}**.\nAcceptes-tu cette offre ?`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_price_${orderId}`).setLabel("Accepter").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject_price_${orderId}`).setLabel("Refuser").setStyle(ButtonStyle.Danger)
  );
  await dmUser(interaction.client, order.discord_id, { embeds: [embed], components: [row] });
}

async function handleAcceptPrice(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", ephemeral: true });

  db.updateOrder(orderId, { status: "pending_review" });
  await interaction.update({
    content: `✅ Offre acceptée ! Ta commande de ${order.quantity}x ${order.item} (${order.total_price} ${config.devise}) est en attente de validation par le staff.`,
    embeds: [],
    components: [],
  });

  const guild = interaction.client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) await postOrderToAdmin(interaction.client, guild, orderId);
}

async function handleRejectPrice(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", ephemeral: true });

  db.updateOrder(orderId, { status: "declined" });
  await interaction.update({ content: "❌ Tu as refusé l'offre. La commande est annulée.", embeds: [], components: [] });
}

// ---------- Poster une commande "prête à valider" dans #admin-commandes ----------
async function postOrderToAdmin(client, guild, orderId) {
  const order = db.getOrder(orderId);
  const chan = await getGuildChannel(guild, "commandes-a-valider");
  if (!chan) return;

  const embed = new EmbedBuilder()
    .setTitle(`🧾 Commande #${order.id}`)
    .setColor("Blue")
    .addFields(
      { name: "Joueur", value: `<@${order.discord_id}> (${order.ign})`, inline: true },
      { name: "Ressource", value: order.item, inline: true },
      { name: "Quantité", value: String(order.quantity), inline: true },
      { name: "Prix total", value: order.total_price != null ? `${order.total_price} ${config.devise}` : "N/A", inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_order_${order.id}`).setLabel("Accepter").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_order_${order.id}`).setLabel("Refuser").setEmoji("❌").setStyle(ButtonStyle.Danger)
  );

  const msg = await chan.send({ embeds: [embed], components: [row] });
  db.updateOrder(order.id, { admin_channel_id: chan.id, admin_message_id: msg.id });
}

// ---------- Staff accepte une commande ----------
async function handleAdminAccept(interaction, orderId) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", ephemeral: true });
  }
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", ephemeral: true });

  db.updateOrder(orderId, { status: "in_progress" });

  const oldEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("Green").setFooter({
    text: `Acceptée par ${interaction.user.tag}`,
  });
  await interaction.update({ embeds: [oldEmbed], components: [] });

  await dmUser(interaction.client, order.discord_id, {
    content: `🔨 Ta commande de **${order.quantity}x ${order.item}** est en cours de préparation !`,
  });

  const pendingChan = await getGuildChannel(interaction.guild, "commandes-en-attente");
  if (pendingChan) {
    const embed = new EmbedBuilder()
      .setTitle(`🔨 Préparation en cours — Commande #${order.id}`)
      .setColor("Yellow")
      .addFields(
        { name: "Joueur", value: `<@${order.discord_id}> (${order.ign})`, inline: true },
        { name: "Ressource", value: order.item, inline: true },
        { name: "Quantité", value: String(order.quantity), inline: true },
        { name: "Prix total", value: order.total_price != null ? `${order.total_price} ${config.devise}` : "N/A", inline: true }
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ready_order_${order.id}`).setLabel("Marquer comme prête").setEmoji("📦").setStyle(ButtonStyle.Success)
    );
    await pendingChan.send({ embeds: [embed], components: [row] });
  }
}

// ---------- Staff refuse une commande ----------
async function handleAdminDeclineButton(interaction, orderId) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId(`decline_modal_${orderId}`).setTitle("Refuser la commande");
  const reasonInput = new TextInputBuilder()
    .setCustomId("decline_reason")
    .setLabel("Raison (optionnel)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return interaction.showModal(modal);
}

async function handleDeclineModalSubmit(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", ephemeral: true });

  const reason = interaction.fields.getTextInputValue("decline_reason") || "Non précisée";
  db.updateOrder(orderId, { status: "declined" });

  const oldEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("Red").setFooter({
    text: `Refusée par ${interaction.user.tag} — ${reason}`,
  });
  await interaction.update({ embeds: [oldEmbed], components: [] });

  await dmUser(interaction.client, order.discord_id, {
    content: `❌ Ta commande de **${order.quantity}x ${order.item}** a été refusée.\nRaison : ${reason}`,
  });
}

// ---------- Staff marque une commande comme prête ----------
async function handleMarkReady(interaction, orderId) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", ephemeral: true });
  }
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", ephemeral: true });

  db.updateOrder(orderId, { status: "ready" });

  const oldEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("Green").setFooter({
    text: `Marquée prête par ${interaction.user.tag}`,
  });
  await interaction.update({ embeds: [oldEmbed], components: [] });

  const embed = new EmbedBuilder()
    .setTitle("📦 Ta commande est prête !")
    .setColor("Green")
    .setDescription(
      `Ta commande de **${order.quantity}x ${order.item}** est prête.\nOuvre un ticket pour venir la récupérer en jeu.`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`open_ticket_${order.id}`).setLabel("Ouvrir un ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary)
  );
  await dmUser(interaction.client, order.discord_id, { embeds: [embed], components: [row] });
}

module.exports = {
  isStaff,
  getGuildChannel,
  dmUser,
  handleOrderStart,
  handleItemSelect,
  handleQtyModalSubmit,
  handleCustomModalSubmit,
  handleProposePriceButton,
  handlePriceModalSubmit,
  handleAcceptPrice,
  handleRejectPrice,
  handleAdminAccept,
  handleAdminDeclineButton,
  handleDeclineModalSubmit,
  handleMarkReady,
};
