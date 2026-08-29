const { EmbedBuilder } = require("discord.js");

function buildHelpEmbed(includeStaff = false) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Toutes les commandes de Stellaria Command")
    .setColor("#F5A623")
    .setDescription("Voici toutes les commandes disponibles, classées par thème.")
    .addFields(
      {
        name: "🔗 Mon compte",
        value:
          "`/link <pseudo>` — relie ton compte Discord à ton pseudo Minecraft\n" +
          "`/unlink` — délie ton compte\n" +
          "`/whoami` — affiche le pseudo actuellement lié",
      },
      {
        name: "🛒 Boutique",
        value:
          "`/mes-commandes` — statut de tes commandes (marche aussi en MP)\n" +
          "Bouton **🛒 Commander** dans #commandes — passer une commande (par catégorie si le staff en a créé)\n" +
          "Bouton **🎨 Commande de bannière Minecraft** dans #commandes — commander une bannière personnalisée\n" +
          "Bouton **📋 Voir mon tableau de bord** dans #mes-achats — même chose, en un clic",
      },
      {
        name: "🎫 Tickets",
        value:
          "`/ticket` — ouvre un ticket avec le staff (formulaire à remplir)\n" +
          "`/signaler` — signale un joueur ou un problème (formulaire à remplir)\n" +
          "Bouton **🎫 Ouvrir un ticket** (reçu en MP) — récupérer une commande prête",
      },
      {
        name: "💡 Communauté",
        value:
          "`/suggerer <texte>` — propose une idée, la communauté vote pour ou contre\n" +
          "`/aide` — affiche ce message",
      }
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" });

  if (includeStaff) {
    embed.addFields({
      name: "🛠️ Staff",
      value:
        "`/setup` — génère/actualise les salons, rôles et embeds du serveur\n" +
        "`/reset` — supprime tous les salons/catégories/rôles créés par /setup (données conservées, confirmation requise)\n" +
        "`/categorie create|remove|list` — gère les catégories du catalogue (Agricole, Minerai...)\n" +
        "`/catalog add|remove|list` — gère les items et prix du catalogue (avec emoji + catégorie)\n" +
        "`/blacklist add|remove|list` — gère la liste noire des joueurs\n" +
        "Boutons **Accepter / Refuser** dans #commandes-a-valider\n" +
        "Bouton **Marquer comme prête** dans #commandes-en-attente\n" +
        "Bouton **Proposer un prix** dans #commandes-non-repertoriees\n" +
        "Boutons **Valider / Refuser** sur chaque suggestion",
    });
  }

  return embed;
}

module.exports = { buildHelpEmbed };
