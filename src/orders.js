const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
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

const STATUS_LABELS = {
  unlisted_review: "🕓 En attente d'un prix",
  pending_review: "🕓 En attente de validation",
  declined: "❌ Refusée",
  in_progress: "🔨 En préparation",
  ready: "📦 Prête (ouvre un ticket)",
  completed: "✅ Terminée",
};

// Récupère l'emoji associé à un item du catalogue, ou 📦 par défaut (items hors catalogue)
function getItemEmoji(itemName) {
  const catalogItem = db.getCatalogItem(itemName);
  return catalogItem?.emoji || "📦";
}

// ---------- Tableau de bord personnel (utilisé par /mes-commandes et par le bouton dans #mes-achats) ----------
function buildDashboardEmbed(discordId) {
  const link = db.getLink(discordId);
  const isBlacklisted = db.isBlacklisted(discordId);
  const orders = db.getOrdersByUser(discordId);

  const embed = new EmbedBuilder()
    .setTitle("📋 Mon tableau de bord Stellaria")
    .setColor(isBlacklisted ? "#992D22" : "#3498DB")
    .setFooter({ text: "Stellaria Command • Stellaria Shop" })
    .setTimestamp();

  embed.addFields({
    name: "🔗 Compte lié",
    value: link ? `Pseudo en jeu : **${link.ign}**` : "Aucun pseudo lié — utilise `/link <pseudo>`",
  });

  if (isBlacklisted) {
    embed.addFields({ name: "🚫 Statut", value: "Tu es actuellement **blacklist**, tu ne peux pas commander." });
  }

  embed.addFields({
    name: "🛒 Mes commandes récentes",
    value:
      orders.length === 0
        ? "Aucune commande enregistrée."
        : orders
            .map(
              (o) =>
                `**#${o.id}** — ${getItemEmoji(o.item)} ${o.quantity}x ${o.item}${o.total_price != null ? ` (${o.total_price} ${config.devise})` : ""}\n${STATUS_LABELS[o.status] || o.status}`
            )
            .join("\n\n"),
  });

  return embed;
}

// Construit le menu déroulant d'items pour une liste donnée (repris à plusieurs endroits)
function buildItemSelectRow(items) {
  const options = items.slice(0, 24).map((i) => ({
    label: i.item,
    description: `${i.unit_qty} unité(s) = ${i.unit_price} ${config.devise}`,
    value: i.item,
    emoji: i.emoji,
  }));
  options.push({
    label: "Autre (non répertorié)",
    description: "La ressource n'est pas dans le catalogue",
    value: "__custom__",
    emoji: "❓",
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("order_select_item")
    .setPlaceholder("Choisis une ressource")
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

function buildCustomItemModal() {
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
  return modal;
}

// ---------- Step 1: bouton "Commander" ----------
async function handleOrderStart(interaction) {
  const link = db.getLink(interaction.user.id);
  if (!link) {
    return interaction.reply({
      content: "❌ Tu dois d'abord lier ton compte avec `/link <pseudo>` avant de commander.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (db.isBlacklisted(interaction.user.id)) {
    return interaction.reply({
      content: "🚫 Tu es blacklist et tu ne peux pas passer de commande. Contacte le staff dans #aide.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const categories = db.listDistinctCatalogCategories();

  const categoryOptions = categories.map((cat) => ({
    label: cat,
    value: cat,
    emoji: db.getCategoryEmoji(cat),
    description: `${db.listCatalogByCategory(cat).length} item(s)`,
  }));
  categoryOptions.push({
    label: "Autre (non répertorié)",
    description: "La ressource n'est dans aucune catégorie",
    value: "__custom__",
    emoji: "❓",
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("order_select_category")
    .setPlaceholder("Choisis une catégorie")
    .addOptions(categoryOptions.slice(0, 25));

  await interaction.reply({
    content: `🛒 Sélectionne une catégorie, ${link.ign} :`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- Step 1.5: sélection d'une catégorie ----------
async function handleCategorySelect(interaction) {
  const value = interaction.values[0];

  if (value === "__custom__") {
    return interaction.showModal(buildCustomItemModal());
  }

  const items = db.listCatalogByCategory(value);
  if (items.length === 0) {
    return interaction.update({
      content: `⚠️ La catégorie **${value}** ne contient aucun item pour le moment.`,
      components: [],
    });
  }

  await interaction.update({
    content: `🛒 Sélectionne une ressource dans **${value}** :`,
    components: [buildItemSelectRow(items)],
  });
}

// ---------- Step 2: sélection d'un item ----------
async function handleItemSelect(interaction) {
  const value = interaction.values[0];

  if (value === "__custom__") {
    return interaction.showModal(buildCustomItemModal());
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
    return interaction.reply({ content: "❌ Tu dois d'abord `/link` ton pseudo.", flags: MessageFlags.Ephemeral });
  }

  const qtyRaw = interaction.fields.getTextInputValue("item_qty");
  const qty = parseInt(qtyRaw, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return interaction.reply({ content: "❌ Quantité invalide.", flags: MessageFlags.Ephemeral });
  }

  const catalogItem = db.getCatalogItem(itemName);
  if (!catalogItem) {
    return interaction.reply({ content: "❌ Cet item n'existe plus dans le catalogue.", flags: MessageFlags.Ephemeral });
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
    flags: MessageFlags.Ephemeral,
  });

  await postOrderToAdmin(interaction.client, interaction.guild, orderId);
}

// ---------- Step 3b: modal pour un item non répertorié ----------
async function handleCustomModalSubmit(interaction) {
  const link = db.getLink(interaction.user.id);
  if (!link) {
    return interaction.reply({ content: "❌ Tu dois d'abord `/link` ton pseudo.", flags: MessageFlags.Ephemeral });
  }

  const itemName = interaction.fields.getTextInputValue("item_name").trim();
  const qtyRaw = interaction.fields.getTextInputValue("item_qty");
  const qty = parseInt(qtyRaw, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return interaction.reply({ content: "❌ Quantité invalide.", flags: MessageFlags.Ephemeral });
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
    flags: MessageFlags.Ephemeral,
  });

  const chan = await getGuildChannel(interaction.guild, "commandes-non-repertoriees");
  if (!chan) return;

  const embed = new EmbedBuilder()
    .setTitle(`📥 Commande non répertoriée #${orderId}`)
    .setColor("#E67E22")
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: "🎮 Joueur", value: `<@${interaction.user.id}> (**${link.ign}**)`, inline: true },
      { name: "📦 Ressource", value: itemName, inline: true },
      { name: "🔢 Quantité", value: String(qty), inline: true }
    )
    .setFooter({ text: "Stellaria Command • Clique sur 'Proposer un prix' pour envoyer une offre au joueur" })
    .setTimestamp();

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
    return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
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
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", flags: MessageFlags.Ephemeral });

  const priceRaw = interaction.fields.getTextInputValue("price_value");
  const price = parseFloat(priceRaw.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    return interaction.reply({ content: "❌ Prix invalide.", flags: MessageFlags.Ephemeral });
  }

  db.updateOrder(orderId, { total_price: price });

  await interaction.reply({ content: `✅ Prix de ${price} ${config.devise} envoyé à ${order.ign}.`, flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setTitle("💰 Offre de prix pour ta commande")
    .setColor("#F1C40F")
    .setDescription(
      `Le staff propose **${price} ${config.devise}** pour **${order.quantity}x ${order.item}**.\n\nAcceptes-tu cette offre ?`
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_price_${orderId}`).setLabel("Accepter").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject_price_${orderId}`).setLabel("Refuser").setStyle(ButtonStyle.Danger)
  );
  await dmUser(interaction.client, order.discord_id, { embeds: [embed], components: [row] });
}

async function handleAcceptPrice(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", flags: MessageFlags.Ephemeral });

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
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", flags: MessageFlags.Ephemeral });

  db.updateOrder(orderId, { status: "declined" });
  await interaction.update({ content: "❌ Tu as refusé l'offre. La commande est annulée.", embeds: [], components: [] });
}

// ---------- Poster une commande "prête à valider" dans #commandes-a-valider ----------
async function postOrderToAdmin(client, guild, orderId) {
  const order = db.getOrder(orderId);
  const chan = await getGuildChannel(guild, "commandes-a-valider");
  if (!chan) return;

  const user = await client.users.fetch(order.discord_id).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle(`🧾 Commande #${order.id}`)
    .setColor("#3498DB")
    .setThumbnail(user?.displayAvatarURL?.() || null)
    .addFields(
      { name: "🎮 Joueur", value: `<@${order.discord_id}> (**${order.ign}**)`, inline: true },
      { name: `${getItemEmoji(order.item)} Ressource`, value: `${order.item}`, inline: true },
      { name: "🔢 Quantité", value: String(order.quantity), inline: true },
      { name: "💰 Prix total", value: order.total_price != null ? `${order.total_price} ${config.devise}` : "N/A", inline: true }
    )
    .setFooter({ text: "Stellaria Command • En attente de validation" })
    .setTimestamp();

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
    return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
  }
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", flags: MessageFlags.Ephemeral });

  db.updateOrder(orderId, { status: "in_progress" });

  const oldEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("#2ECC71").setFooter({
    text: `✅ Acceptée par ${interaction.user.tag}`,
  });
  await interaction.update({ embeds: [oldEmbed], components: [] });

  await dmUser(interaction.client, order.discord_id, {
    embeds: [
      new EmbedBuilder()
        .setTitle("🔨 Commande en préparation")
        .setColor("#F1C40F")
        .setDescription(`Ta commande de **${order.quantity}x ${order.item}** est acceptée et en cours de préparation par le staff !`)
        .setFooter({ text: "Stellaria Command • Stellaria Shop" }),
    ],
  });

  const pendingChan = await getGuildChannel(interaction.guild, "commandes-en-attente");
  if (pendingChan) {
    const user = await interaction.client.users.fetch(order.discord_id).catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle(`🔨 Préparation en cours — Commande #${order.id}`)
      .setColor("#F1C40F")
      .setThumbnail(user?.displayAvatarURL?.() || null)
      .addFields(
        { name: "🎮 Joueur", value: `<@${order.discord_id}> (**${order.ign}**)`, inline: true },
        { name: `${getItemEmoji(order.item)} Ressource`, value: order.item, inline: true },
        { name: "🔢 Quantité", value: String(order.quantity), inline: true },
        { name: "💰 Prix total", value: order.total_price != null ? `${order.total_price} ${config.devise}` : "N/A", inline: true }
      )
      .setFooter({ text: "Stellaria Command • À marquer prête une fois préparée" })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ready_order_${order.id}`).setLabel("Marquer comme prête").setEmoji("📦").setStyle(ButtonStyle.Success)
    );
    await pendingChan.send({ embeds: [embed], components: [row] });
  }
}

// ---------- Staff refuse une commande ----------
async function handleAdminDeclineButton(interaction, orderId) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
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
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", flags: MessageFlags.Ephemeral });

  const reason = interaction.fields.getTextInputValue("decline_reason") || "Non précisée";
  db.updateOrder(orderId, { status: "declined" });

  const oldEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("#E74C3C").setFooter({
    text: `❌ Refusée par ${interaction.user.tag} — ${reason}`,
  });
  await interaction.update({ embeds: [oldEmbed], components: [] });

  await dmUser(interaction.client, order.discord_id, {
    embeds: [
      new EmbedBuilder()
        .setTitle("❌ Commande refusée")
        .setColor("#E74C3C")
        .setDescription(`Ta commande de **${order.quantity}x ${order.item}** a été refusée par le staff.`)
        .addFields({ name: "📝 Raison", value: reason })
        .setFooter({ text: "Stellaria Command • Stellaria Shop" }),
    ],
  });
}

// ---------- Staff marque une commande comme prête ----------
async function handleMarkReady(interaction, orderId) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
  }
  const order = db.getOrder(orderId);
  if (!order) return interaction.reply({ content: "❌ Commande introuvable.", flags: MessageFlags.Ephemeral });

  db.updateOrder(orderId, { status: "ready" });

  const oldEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("#2ECC71").setFooter({
    text: `📦 Marquée prête par ${interaction.user.tag}`,
  });
  await interaction.update({ embeds: [oldEmbed], components: [] });

  const embed = new EmbedBuilder()
    .setTitle("📦 Ta commande est prête !")
    .setColor("#2ECC71")
    .setDescription(
      `🎉 Ta commande de **${order.quantity}x ${order.item}** est prête !\nOuvre un ticket pour venir la récupérer en jeu.`
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`open_ticket_${order.id}`).setLabel("Ouvrir un ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary)
  );
  await dmUser(interaction.client, order.discord_id, { embeds: [embed], components: [row] });
}

// ---------- Bouton "Voir mon tableau de bord" dans #mes-achats ----------
async function handleDashboardButton(interaction) {
  const embed = buildDashboardEmbed(interaction.user.id);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  isStaff,
  getGuildChannel,
  dmUser,
  getItemEmoji,
  buildDashboardEmbed,
  handleDashboardButton,
  handleOrderStart,
  handleCategorySelect,
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
