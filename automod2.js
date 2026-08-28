const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

// ======================================================
// NEXONA - AUTOMOD 2
// /talk command
// ======================================================

const commands = [
    new SlashCommandBuilder()
        .setName("talk")
        .setDescription("Make Nexona send a message.")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("The message Nexona will send.")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
];

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName !== "talk") return;

    // Extra security check
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({
            content: "You need the **Manage Messages** permission to use this command.",
            ephemeral: true
        });
    }

    const text = interaction.options.getString("text", true);

    await interaction.reply({
        content: text
    });
}

async function handleMessage(message) {
    // AutoMod 2 message systems will be added here later.
}

module.exports = {
    commands,
    handleInteraction,
    handleMessage
};