const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("./database");

function buildConfirmEmbed() {
  return new EmbedBuilder()
    .setTitle("⚠️ Réinitialiser la structure du serveur")
    .setColor("#E74C3C")
    .setDescription(
      "Cette action va **supprimer tous les salons, catégories et rôles** créés par `/setup` " +
        "(y compris les tickets actuellement ouverts).\n\n" +
        "✅ **Conservé** : le catalogue, les commandes, les liens de comptes, la blacklist et les suggestions.\n" +
        "❌ **Supprimé** : salons, catégories, rôles, messages épinglés.\n\n" +
        "Cette action est **irréversible**. Tu pourras relancer `/setup` juste après pour tout regénérer proprement.\n\nConfirmer ?"
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" });
}

function buildConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reset_confirm").setLabel("Confirmer la suppression").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("reset_cancel").setLabel("Annuler").setEmoji("✖️").setStyle(ButtonStyle.Secondary)
  );
}

// ---------- /reset : étape 1, demande confirmation ----------
async function handleResetCommand(interaction) {
  await interaction.reply({
    embeds: [buildConfirmEmbed()],
    components: [buildConfirmRow()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleResetCancel(interaction) {
  await interaction.update({
    content: "❎ Réinitialisation annulée, rien n'a été supprimé.",
    embeds: [],
    components: [],
  });
}

// ---------- /reset : étape 2, suppression effective ----------
async function handleResetConfirm(interaction) {
  // Deferred car la suppression de nombreux salons/rôles peut prendre plus de 3 secondes
  await interaction.deferUpdate();

  const guild = interaction.guild;
  const results = { channels: 0, categories: 0, roles: 0, tickets: 0, errors: 0 };

  // ---- 1. Salons dynamiques liés à des tickets encore ouverts ----
  const openTickets = db.getAllOpenTickets();
  for (const ticket of openTickets) {
    try {
      const chan = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (chan) {
        await chan.delete().catch(() => {});
        results.tickets++;
      }
      db.closeTicket(ticket.channel_id);
    } catch {
      results.errors++;
    }
  }

  // ---- 2. Salons fixes créés par /setup (préfixe 'channel:') ----
  const channelSettings = db.listSettingsByPrefix("channel:");
  for (const row of channelSettings) {
    try {
      const chan = await guild.channels.fetch(row.value).catch(() => null);
      if (chan) {
        await chan.delete().catch(() => {});
        results.channels++;
      }
    } catch {
      results.errors++;
    }
  }

  // ---- 3. Catégories créées par /setup (préfixe 'category:') ----
  const categorySettings = db.listSettingsByPrefix("category:");
  for (const row of categorySettings) {
    try {
      const chan = await guild.channels.fetch(row.value).catch(() => null);
      if (chan) {
        await chan.delete().catch(() => {});
        results.categories++;
      }
    } catch {
      results.errors++;
    }
  }

  // ---- 4. Rôles créés par /setup (préfixe 'role:') ----
  const roleSettings = db.listSettingsByPrefix("role:");
  for (const row of roleSettings) {
    try {
      const role = await guild.roles.fetch(row.value).catch(() => null);
      if (role) {
        await role.delete().catch(() => {});
        results.roles++;
      }
    } catch {
      results.errors++;
    }
  }

  // ---- 5. Nettoyage des réglages stockés (les données métier ne sont PAS touchées) ----
  db.deleteSettingsByPrefix("channel:");
  db.deleteSettingsByPrefix("category:");
  db.deleteSettingsByPrefix("role:");
  db.deleteSettingsByPrefix("message:");
  db.deleteSettingsByPrefix("reglement_channel");

  const summaryEmbed = new EmbedBuilder()
    .setTitle("✅ Structure réinitialisée")
    .setColor("#2ECC71")
    .setDescription(
      `🗑️ ${results.channels} salon(s) supprimé(s)\n` +
        `🗑️ ${results.categories} catégorie(s) supprimée(s)\n` +
        `🗑️ ${results.roles} rôle(s) supprimé(s)\n` +
        `🎫 ${results.tickets} ticket(s) ouvert(s) fermé(s)\n` +
        (results.errors ? `⚠️ ${results.errors} élément(s) déjà absent(s) ou impossible(s) à supprimer\n` : "") +
        `\n💾 Le catalogue, les commandes, les liens de comptes, la blacklist et les suggestions sont conservés.\n\n` +
        `▶️ Utilise \`/setup\` pour tout régénérer.`
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" });

  await interaction.editReply({ embeds: [summaryEmbed], components: [] });
}

module.exports = { handleResetCommand, handleResetConfirm, handleResetCancel };
