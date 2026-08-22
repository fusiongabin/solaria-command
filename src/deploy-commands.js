require("dotenv").config();
const { REST, Routes } = require("discord.js");
const commands = require("./commands");

const body = commands.map((c) => c.data.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Déploiement de ${body.length} commande(s)...`);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
      body,
    });
    console.log("✅ Commandes déployées avec succès sur le serveur.");
  } catch (err) {
    console.error(err);
  }
})();
