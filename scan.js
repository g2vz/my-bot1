
const {
  SlashCommandBuilder
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const BOT_OWNER_ID = "1486246219243323503";

const CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789._";

const commands = [
  new SlashCommandBuilder()
    .setName("scan")
    .setDescription("Generate username candidates")
    .addIntegerOption(option =>
      option
        .setName("length")
        .setDescription("Username length")
        .setRequired(true)
        .addChoices(
          { name: "3 characters", value: 3 },
          { name: "4 characters", value: 4 },
          { name: "5 characters", value: 5 }
        )
    )
    .toJSON()
];

function* generateUsernames(length) {
  const chars = CHARACTERS;

  function* build(prefix, remaining) {
    if (remaining === 0) {
      yield prefix;
      return;
    }

    for (const char of chars) {
      yield* build(prefix + char, remaining - 1);
    }
  }

  yield* build("", length);
}

async function handleInteraction(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== "scan"
  ) {
    return;
  }

  if (interaction.user.id !== BOT_OWNER_ID) {
    return interaction.reply({
      content: "You are not authorized to use this command.",
      ephemeral: true
    });
  }

  const length = interaction.options.getInteger("length");

  await interaction.deferReply({ ephemeral: true });

  const outputFile = path.join(
    __dirname,
    `candidates-${length}.txt`
  );

  const stream = fs.createWriteStream(outputFile);

  let count = 0;

  for (const username of generateUsernames(length)) {
    stream.write(username + "\n");
    count++;
  }

  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  await interaction.editReply(
    `Generated ${count.toLocaleString()} candidates of length ${length}. ` +
    `Saved to candidates-${length}.txt. ` +
    `Availability has not been checked.`
  );
}

module.exports = {
  commands,
  handleInteraction
};
