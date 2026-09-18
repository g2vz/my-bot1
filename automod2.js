const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    InteractionContextType,
    ApplicationIntegrationType
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
        // Required for user-installed apps and DM visibility.
        .setIntegrationTypes(
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        )
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
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

    // The owner can always use /talk. Others still need Manage Messages,
    // but only when they are in a guild context.
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

    // In DM/private-channel contexts, Discord may not allow ephemeral replies.
    // Defer first, then send the message to the current channel.
    await interaction.deferReply({
        ephemeral: false
    }).catch(() => {});

    try {
        if (interaction.channel) {
            await interaction.channel.send({
                content: text
            });
        }

        await interaction.deleteReply().catch(() => {});
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
