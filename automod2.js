const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    InteractionContextType
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
        // Explicitly allow this command in servers and bot DMs.
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM
        )
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
    // need Manage Messages in a server.
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

    // Acknowledge first so Discord does not time out the interaction while
    // the bot sends the message. Ephemeral replies are avoided because the
    // DM interaction context does not support them consistently.
    await interaction.deferReply();

    try {
        await interaction.channel.send({
            content: text
        });

        // Remove the acknowledgement so only the message sent by Nexona
        // remains visible.
        await interaction.deleteReply();
    } catch (error) {
        console.error("NEXONA TALK ERROR:", error);

        await interaction.editReply({
            content: "I could not send that message in this channel."
        }).catch(() => {});
    }
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
