const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

// ======================================================
// NEXONA - AUTOMOD 2
// ======================================================

const commands = [
    new SlashCommandBuilder()
        .setName("talk")
        .setDescription("make Nexona say smt you want her to say.")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("what do you want her to say?.")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
];

async function handleInteraction(interaction) {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName !== "talk") {
        return;
    }

    // Check permission
    if (
        !interaction.memberPermissions ||
        !interaction.memberPermissions.has(
            PermissionFlagsBits.ManageMessages
        )
    ) {
        return interaction.reply({
            content:
                "You need the **Manage Messages** permission to use this command.",
            ephemeral: true
        });
    }

    const text = interaction.options.getString(
        "text",
        true
    );

    // Send the actual message as Nexona
    await interaction.channel.send({
        content: text
    });

    // Remove the slash command interaction response
    // without sending a visible bot message.
    await interaction.deferReply({
        ephemeral: true
    });

    await interaction.deleteReply().catch(() => {});
}

// ======================================================
// MESSAGE HANDLER
// ======================================================

async function handleMessage(message) {
    // Reserved for the AutoMod 2 system.
}

// ======================================================
// EXPORT
// ======================================================

module.exports = {
    commands,
    handleInteraction,
    handleMessage
};