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
                .setDescription("type smt you want Nexona to say!.")
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
            content: "**seems like you don't have the perms to use this command😔 you have to get __manage messages__ perms to use this command.",
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