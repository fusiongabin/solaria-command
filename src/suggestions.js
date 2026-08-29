const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("./database");
const { isStaff, getGuildChannel, dmUser } = require("./orders");

function buildSuggestionEmbed(suggestion, author) {
  const { up, down } = db.getSuggestionVoteCounts(suggestion.id);
  const statusLabel =
    suggestion.status === "validated" ? "✅ Validée" : suggestion.status === "rejected" ? "❌ Refusée" : "🗳️ En vote";
  const color = suggestion.status === "validated" ? "#2ECC71" : suggestion.status === "rejected" ? "#E74C3C" : "#F5A623";

  return new EmbedBuilder()
    .setTitle(`💡 Suggestion #${suggestion.id}`)
    .setColor(color)
    .setThumbnail(author?.displayAvatarURL?.() || null)
    .setDescription(suggestion.text)
    .addFields(
      { name: "🙋 Proposée par", value: `<@${suggestion.discord_id}>`, inline: true },
      { name: "📊 Statut", value: statusLabel, inline: true },
      { name: "👍 Pour", value: String(up), inline: true },
      { name: "👎 Contre", value: String(down), inline: true }
    )
    .setFooter({ text: "Stellaria Command • Stellaria Shop" })
    .setTimestamp(suggestion.created_at);
}

function buildVoteRow(suggestion) {
  const disabled = suggestion.status !== "open";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`suggestion_vote_up_${suggestion.id}`).setLabel("Pour").setEmoji("👍").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`suggestion_vote_down_${suggestion.id}`).setLabel("Contre").setEmoji("👎").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function buildStaffRow(suggestion) {
  const disabled = suggestion.status !== "open";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`suggestion_validate_${suggestion.id}`).setLabel("Valider").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`suggestion_reject_${suggestion.id}`).setLabel("Refuser").setEmoji("❌").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

// ---------- /suggerer <texte> ----------
async function handleSuggestCommand(interaction) {
  const text = interaction.options.getString("texte");
  const chan = await getGuildChannel(interaction.guild, "suggestions");
  if (!chan) {
    return interaction.reply({ content: "❌ Le salon #suggestions n'existe pas encore. Demande à un admin de lancer `/setup`.", flags: MessageFlags.Ephemeral });
  }

  const id = db.createSuggestion(interaction.user.id, text);
  const suggestion = db.getSuggestion(id);

  const embed = buildSuggestionEmbed(suggestion, interaction.user);
  const rows = [buildVoteRow(suggestion)];
  if (isStaff(interaction.member)) rows.push(buildStaffRow(suggestion));

  const msg = await chan.send({ embeds: [embed], components: rows });
  db.updateSuggestion(id, { channel_id: chan.id, message_id: msg.id });

  return interaction.reply({ content: `✅ Ta suggestion a été postée dans <#${chan.id}> !`, flags: MessageFlags.Ephemeral });
}

async function refreshSuggestionMessage(interaction, suggestion) {
  const author = await interaction.client.users.fetch(suggestion.discord_id).catch(() => null);
  const embed = buildSuggestionEmbed(suggestion, author);
  const rows = [buildVoteRow(suggestion), buildStaffRow(suggestion)];
  await interaction.update({ embeds: [embed], components: rows }).catch(async () => {
    if (suggestion.channel_id && suggestion.message_id) {
      const chan = await interaction.guild.channels.fetch(suggestion.channel_id).catch(() => null);
      const msg = chan && (await chan.messages.fetch(suggestion.message_id).catch(() => null));
      if (msg) await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
    }
  });
}

// ---------- Votes ----------
async function handleVote(interaction, suggestionId, voteValue) {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion) return interaction.reply({ content: "❌ Suggestion introuvable.", flags: MessageFlags.Ephemeral });
  if (suggestion.status !== "open") {
    return interaction.reply({ content: "⚠️ Cette suggestion n'est plus ouverte au vote.", flags: MessageFlags.Ephemeral });
  }

  db.setSuggestionVote(suggestionId, interaction.user.id, voteValue);
  const updated = db.getSuggestion(suggestionId);
  await refreshSuggestionMessage(interaction, updated);
}

// ---------- Décision staff ----------
async function handleStaffDecision(interaction, suggestionId, decision) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: "❌ Réservé au staff.", flags: MessageFlags.Ephemeral });
  }
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion) return interaction.reply({ content: "❌ Suggestion introuvable.", flags: MessageFlags.Ephemeral });

  db.updateSuggestion(suggestionId, { status: decision });
  const updated = db.getSuggestion(suggestionId);
  await refreshSuggestionMessage(interaction, updated);

  const label = decision === "validated" ? "✅ validée" : "❌ refusée";
  await dmUser(interaction.client, suggestion.discord_id, {
    content: `📊 Ta suggestion **"${suggestion.text}"** a été ${label} par le staff.`,
  }).catch(() => {});
}

module.exports = { handleSuggestCommand, handleVote, handleStaffDecision };
