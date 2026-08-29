const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const config = require("../config.json");
const db = require("./database");
const { runSetup } = require("./setup");
const { isStaff, buildDashboardEmbed } = require("./orders");

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
          flags: MessageFlags.Ephemeral,
        });
      }
      const existing = db.getLinkByIgn(pseudo);
      if (existing && existing.discord_id !== interaction.user.id) {
        return interaction.reply({
          content: "❌ Ce pseudo est déjà lié à un autre compte Discord. Contacte le staff si c'est une erreur.",
          flags: MessageFlags.Ephemeral,
        });
      }
      db.linkAccount(interaction.user.id, pseudo);
      return interaction.reply({
        content: `✅ Ton compte Discord est maintenant lié au pseudo **${pseudo}**.`,
        flags: MessageFlags.Ephemeral,
      });
    },
  },

  // ---------------- /unlink ----------------
  {
    data: new SlashCommandBuilder().setName("unlink").setDescription("Délie ton compte Discord de ton pseudo Minecraft"),
    async execute(interaction) {
      db.unlinkAccount(interaction.user.id);
      return interaction.reply({ content: "✅ Ton compte a été délié.", flags: MessageFlags.Ephemeral });
    },
  },

  // ---------------- /whoami ----------------
  {
    data: new SlashCommandBuilder().setName("whoami").setDescription("Affiche le pseudo lié à ton compte"),
    async execute(interaction) {
      const link = db.getLink(interaction.user.id);
      if (!link) {
        return interaction.reply({ content: "❌ Aucun pseudo lié. Utilise `/link <pseudo>`.", flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `🔗 Ton compte est lié au pseudo **${link.ign}**.`, flags: MessageFlags.Ephemeral });
    },
  },

  // ---------------- /mes-commandes ----------------
  {
    data: new SlashCommandBuilder()
      .setName("mes-commandes")
      .setDescription("Affiche le statut de tes commandes en cours (utilisable en MP)"),
    async execute(interaction) {
      const embed = buildDashboardEmbed(interaction.user.id);
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },

  // ---------------- /setup (admin) ----------------
  {
    data: new SlashCommandBuilder()
      .setName("setup")
      .setDescription("(Admin) Génère automatiquement les salons, rôles et embeds du serveur")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await runSetup(interaction.guild);
        await interaction.editReply("✅ Structure du serveur générée avec succès (salons, rôles, règlement, catalogue).");
      } catch (err) {
        console.error(err);
        await interaction.editReply(`❌ Erreur pendant le setup : ${err.message}`);
      }
    },
  },

  // ---------------- /reset (admin) ----------------
  {
    data: new SlashCommandBuilder()
      .setName("reset")
      .setDescription("(Admin) Supprime tous les salons/catégories/rôles créés par /setup (données conservées)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
      const { handleResetCommand } = require("./reset");
      await handleResetCommand(interaction);
    },
  },

  // ---------------- /categorie (staff) ----------------
  {
    data: new SlashCommandBuilder()
      .setName("categorie")
      .setDescription("(Staff) Gère les catégories du catalogue")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Crée ou met à jour une catégorie (ex: Agricole, Minerai, Loot de mobs)")
          .addStringOption((o) => o.setName("nom").setDescription("Nom de la catégorie").setRequired(true))
          .addStringOption((o) => o.setName("emoji").setDescription("Emoji de la catégorie. Défaut : 📁").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Supprime une catégorie (ses items repassent dans 'Général')")
          .addStringOption((o) => o.setName("nom").setDescription("Nom de la catégorie").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Affiche toutes les catégories")),
    async execute(interaction) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
      }
      const sub = interaction.options.getSubcommand();

      if (sub === "create") {
        const nom = interaction.options.getString("nom").trim();
        const emoji = interaction.options.getString("emoji") || "📁";
        db.createCategory(nom, emoji);
        return interaction.reply({ content: `✅ Catégorie ${emoji} **${nom}** créée. Utilise \`/catalog add\` avec \`categorie:${nom}\` pour y ranger des items.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "remove") {
        const nom = interaction.options.getString("nom").trim();
        db.removeCategory(nom);
        return interaction.reply({ content: `✅ Catégorie **${nom}** supprimée. Ses items sont repassés dans **Général**.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "list") {
        const cats = db.listCategories();
        const desc = cats.length
          ? cats.map((c) => `${c.emoji} **${c.name}** — ${db.listCatalogByCategory(c.name).length} item(s)`).join("\n")
          : "Aucune catégorie créée pour le moment (les items sans catégorie sont dans 'Général').";
        const embed = new EmbedBuilder()
          .setTitle("📁 Catégories du catalogue")
          .setDescription(desc)
          .setColor("#3498DB")
          .setFooter({ text: "Stellaria Command • Stellaria Shop" });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
          .addStringOption((o) => o.setName("emoji").setDescription("Emoji pour cet item (ex: 🌾, 🪵, 💎). Défaut : 📦").setRequired(false))
          .addStringOption((o) => o.setName("categorie").setDescription("Catégorie (ex: Agricole, Minerai). Défaut : Général").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Retire un item du catalogue")
          .addStringOption((o) => o.setName("item").setDescription("Nom de la ressource").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Affiche le catalogue actuel, classé par catégorie")),
    async execute(interaction) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
      }
      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const item = interaction.options.getString("item").toLowerCase();
        const unite = interaction.options.getInteger("unite");
        const prix = interaction.options.getNumber("prix");
        const emoji = interaction.options.getString("emoji") || "📦";
        const categorie = interaction.options.getString("categorie") || "Général";
        db.upsertCatalogItem(item, unite, prix, emoji, categorie);
        return interaction.reply({ content: `✅ ${emoji} **${item}** ajouté/mis à jour dans **${categorie}** : ${unite} unité(s) = ${prix} ${config.devise}. Il apparaîtra dans le menu de commande de #commandes.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "remove") {
        const item = interaction.options.getString("item").toLowerCase();
        db.removeCatalogItem(item);
        return interaction.reply({ content: `✅ **${item}** retiré du catalogue.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "list") {
        const items = db.listCatalog();
        let desc;
        if (!items.length) {
          desc = "Le catalogue est vide.";
        } else {
          const byCategory = {};
          for (const i of items) {
            if (!byCategory[i.category]) byCategory[i.category] = [];
            byCategory[i.category].push(i);
          }
          desc = Object.entries(byCategory)
            .map(([cat, catItems]) => {
              const catEmoji = db.getCategoryEmoji(cat);
              const lines = catItems.map((i) => `${i.emoji} **${i.item}** — ${i.unit_qty} unité(s) = 💰 ${i.unit_price} ${config.devise}`).join("\n");
              return `${catEmoji} __${cat}__\n${lines}`;
            })
            .join("\n\n");
        }
        const embed = new EmbedBuilder()
          .setTitle("📦 Catalogue Stellaria")
          .setDescription(desc)
          .setColor("#3498DB")
          .setFooter({ text: "Stellaria Command • Stellaria Shop" });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
        return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
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
        return interaction.reply({ content: `🚫 ${user.tag} a été blacklist. Raison : ${raison}`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "remove") {
        const user = interaction.options.getUser("utilisateur");
        db.removeBlacklist(user.id);
        const blacklistRoleId = db.getSetting("role:blacklist");
        if (blacklistRoleId) {
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (member) await member.roles.remove(blacklistRoleId).catch(() => {});
        }
        return interaction.reply({ content: `✅ ${user.tag} retiré de la blacklist.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "list") {
        const rows = db.listBlacklist();
        const desc = rows.length
          ? rows.map((r) => `👤 <@${r.discord_id}> — 📝 ${r.reason}`).join("\n")
          : "✅ Aucun joueur blacklist.";
        const embed = new EmbedBuilder()
          .setTitle("🚫 Liste noire")
          .setDescription(desc)
          .setColor("#992D22")
          .setFooter({ text: "Stellaria Command • Stellaria Shop" });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    },
  },

  // ---------------- /ticket (ouvre un formulaire puis un ticket "autre") ----------------
  {
    data: new SlashCommandBuilder().setName("ticket").setDescription("Ouvre un ticket pour contacter le staff (formulaire à remplir)"),
    async execute(interaction) {
      const { handleOtherTicketCommand } = require("./tickets");
      await handleOtherTicketCommand(interaction);
    },
  },

  // ---------------- /signaler (formulaire de signalement) ----------------
  {
    data: new SlashCommandBuilder().setName("signaler").setDescription("Signale un joueur ou un problème (formulaire à remplir)"),
    async execute(interaction) {
      const { handleReportCommand } = require("./tickets");
      await handleReportCommand(interaction);
    },
  },

  // ---------------- /suggerer ----------------
  {
    data: new SlashCommandBuilder()
      .setName("suggerer")
      .setDescription("Propose une idée, la communauté vote et le staff décide")
      .addStringOption((o) =>
        o.setName("texte").setDescription("Ta suggestion").setRequired(true).setMaxLength(500)
      ),
    async execute(interaction) {
      const { handleSuggestCommand } = require("./suggestions");
      await handleSuggestCommand(interaction);
    },
  },

  // ---------------- /aide (liste des commandes) ----------------
  {
    data: new SlashCommandBuilder().setName("aide").setDescription("Affiche la liste de toutes les commandes disponibles"),
    async execute(interaction) {
      const { buildHelpEmbed } = require("./help");
      return interaction.reply({ embeds: [buildHelpEmbed(isStaff(interaction.member))], flags: MessageFlags.Ephemeral });
    },
  },
];

module.exports = commands;
