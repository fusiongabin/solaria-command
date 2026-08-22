const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("../config.json");
const db = require("./database");
const { runSetup } = require("./setup");
const { isStaff } = require("./orders");

const commands = [
  // ---------------- /link ----------------
  {
    data: new SlashCommandBuilder()
      .setName("link")
      .setDescription("Lie ton compte Discord à ton pseudo Minecraft")
      .addStringOption((opt) =>
        opt.setName("pseudo").setDescription("Ton pseudo en jeu").setRequired(true)
      ),
    async execute(interaction) {
      const pseudo = interaction.options.getString("pseudo").trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(pseudo)) {
        return interaction.reply({
          content: "❌ Pseudo invalide (3 à 16 caractères, lettres/chiffres/underscore uniquement).",
          ephemeral: true,
        });
      }
      const existing = db.getLinkByIgn(pseudo);
      if (existing && existing.discord_id !== interaction.user.id) {
        return interaction.reply({
          content: "❌ Ce pseudo est déjà lié à un autre compte Discord. Contacte le staff si c'est une erreur.",
          ephemeral: true,
        });
      }
      db.linkAccount(interaction.user.id, pseudo);
      return interaction.reply({
        content: `✅ Ton compte Discord est maintenant lié au pseudo **${pseudo}**.`,
        ephemeral: true,
      });
    },
  },

  // ---------------- /unlink ----------------
  {
    data: new SlashCommandBuilder().setName("unlink").setDescription("Délie ton compte Discord de ton pseudo Minecraft"),
    async execute(interaction) {
      db.unlinkAccount(interaction.user.id);
      return interaction.reply({ content: "✅ Ton compte a été délié.", ephemeral: true });
    },
  },

  // ---------------- /whoami ----------------
  {
    data: new SlashCommandBuilder().setName("whoami").setDescription("Affiche le pseudo lié à ton compte"),
    async execute(interaction) {
      const link = db.getLink(interaction.user.id);
      if (!link) {
        return interaction.reply({ content: "❌ Aucun pseudo lié. Utilise `/link <pseudo>`.", ephemeral: true });
      }
      return interaction.reply({ content: `🔗 Ton compte est lié au pseudo **${link.ign}**.`, ephemeral: true });
    },
  },

  // ---------------- /mes-commandes ----------------
  {
    data: new SlashCommandBuilder()
      .setName("mes-commandes")
      .setDescription("Affiche le statut de tes commandes en cours (utilisable en MP)"),
    async execute(interaction) {
      const orders = db.getOrdersByUser(interaction.user.id);
      if (orders.length === 0) {
        return interaction.reply({ content: "Tu n'as aucune commande enregistrée.", ephemeral: true });
      }
      const statusLabels = {
        unlisted_review: "🕓 En attente d'un prix",
        pending_review: "🕓 En attente de validation",
        declined: "❌ Refusée",
        in_progress: "🔨 En préparation",
        ready: "📦 Prête (ouvre un ticket)",
        completed: "✅ Terminée",
      };
      const embed = new EmbedBuilder()
        .setTitle("📋 Tes commandes")
        .setColor("Blue")
        .setDescription(
          orders
            .map(
              (o) =>
                `**#${o.id}** — ${o.quantity}x ${o.item}${o.total_price != null ? ` (${o.total_price} ${config.devise})` : ""}\n${statusLabels[o.status] || o.status}`
            )
            .join("\n\n")
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },

  // ---------------- /setup (admin) ----------------
  {
    data: new SlashCommandBuilder()
      .setName("setup")
      .setDescription("(Admin) Génère automatiquement les salons, rôles et embeds du serveur")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      try {
        await runSetup(interaction.guild);
        await interaction.editReply("✅ Structure du serveur générée avec succès (salons, rôles, règlement, catalogue).");
      } catch (err) {
        console.error(err);
        await interaction.editReply(`❌ Erreur pendant le setup : ${err.message}`);
      }
    },
  },

  // ---------------- /catalog (staff) ----------------
  {
    data: new SlashCommandBuilder()
      .setName("catalog")
      .setDescription("(Staff) Gère le catalogue de ressources")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Ajoute ou met à jour un item du catalogue")
          .addStringOption((o) => o.setName("item").setDescription("Nom de la ressource").setRequired(true))
          .addIntegerOption((o) => o.setName("unite").setDescription("Quantité de référence").setRequired(true))
          .addNumberOption((o) => o.setName("prix").setDescription("Prix pour cette quantité").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Retire un item du catalogue")
          .addStringOption((o) => o.setName("item").setDescription("Nom de la ressource").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Affiche le catalogue actuel")),
    async execute(interaction) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Réservé au staff.", ephemeral: true });
      }
      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const item = interaction.options.getString("item").toLowerCase();
        const unite = interaction.options.getInteger("unite");
        const prix = interaction.options.getNumber("prix");
        db.upsertCatalogItem(item, unite, prix);
        return interaction.reply({ content: `✅ **${item}** ajouté/mis à jour : ${unite} unité(s) = ${prix} ${config.devise}. Il apparaîtra dans le menu de commande de #commandes.`, ephemeral: true });
      }

      if (sub === "remove") {
        const item = interaction.options.getString("item").toLowerCase();
        db.removeCatalogItem(item);
        return interaction.reply({ content: `✅ **${item}** retiré du catalogue.`, ephemeral: true });
      }

      if (sub === "list") {
        const items = db.listCatalog();
        const desc = items.length
          ? items.map((i) => `**${i.item}** — ${i.unit_qty} unité(s) = ${i.unit_price} ${config.devise}`).join("\n")
          : "Le catalogue est vide.";
        const embed = new EmbedBuilder().setTitle("📦 Catalogue").setDescription(desc).setColor("Aqua");
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    },
  },

  // ---------------- /blacklist (staff) ----------------
  {
    data: new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("(Staff) Gère la liste noire des joueurs")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Blacklist un joueur")
          .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur à blacklist").setRequired(true))
          .addStringOption((o) => o.setName("raison").setDescription("Raison"))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Retire un joueur de la blacklist")
          .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur à retirer").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Affiche la liste noire")),
    async execute(interaction) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Réservé au staff.", ephemeral: true });
      }
      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const user = interaction.options.getUser("utilisateur");
        const raison = interaction.options.getString("raison") || "Non précisée";
        db.addBlacklist(user.id, raison, interaction.user.id);

        const blacklistRoleId = db.getSetting("role:blacklist");
        if (blacklistRoleId) {
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (member) await member.roles.add(blacklistRoleId).catch(() => {});
        }
        return interaction.reply({ content: `🚫 ${user.tag} a été blacklist. Raison : ${raison}`, ephemeral: true });
      }

      if (sub === "remove") {
        const user = interaction.options.getUser("utilisateur");
        db.removeBlacklist(user.id);
        const blacklistRoleId = db.getSetting("role:blacklist");
        if (blacklistRoleId) {
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (member) await member.roles.remove(blacklistRoleId).catch(() => {});
        }
        return interaction.reply({ content: `✅ ${user.tag} retiré de la blacklist.`, ephemeral: true });
      }

      if (sub === "list") {
        const rows = db.listBlacklist();
        const desc = rows.length
          ? rows.map((r) => `<@${r.discord_id}> — ${r.reason}`).join("\n")
          : "Aucun joueur blacklist.";
        const embed = new EmbedBuilder().setTitle("🚫 Blacklist").setDescription(desc).setColor("DarkRed");
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    },
  },

  // ---------------- /ticket (créer un ticket libre) ----------------
  {
    data: new SlashCommandBuilder().setName("ticket").setDescription("Ouvre un ticket pour contacter le staff"),
    async execute(interaction) {
      const { handleOpenTicket } = require("./tickets");
      await handleOpenTicket(interaction, null);
    },
  },
];

module.exports = commands;
