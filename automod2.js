const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

// ======================================================
// NEXONA - AUTOMOD 2
// ======================================================

const OWNER_ID = "1193602200644091957";

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
        // Do not set a default member permission here. Discord can block
        // the owner before the interaction reaches the handler otherwise.
        .setDMPermission(true)
];

async function handleInteraction(interaction) {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName !== "talk") {
        return;
    }

    const isOwner = interaction.user.id === OWNER_ID;
    const canManageMessages = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
    );

    // The owner can use /talk anywhere, including DMs. Other users still
    // need Manage Messages, as before.
    if (!isOwner && !canManageMessages) {
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

    // Send the actual message as Nexona in the current channel, whether it
    // is a server channel or a DM channel.
    await interaction.channel.send({
        content: text
    });

    // Remove the slash command interaction response without sending a
    // visible bot message.
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
