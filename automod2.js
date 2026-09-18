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

    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "talk"
    ) {
        return;
    }

    const isOwner = interaction.user.id === OWNER_ID;
    const canManageMessages = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
    );

    // The owner can use /talk anywhere. Other users need Manage Messages.
    if (!isOwner && !canManageMessages) {
        return interaction.reply({
            content:
                "You need the **Manage Messages** permission to use this command.",
            ephemeral: true
        });
    }

    const text = interaction.options.getString("text", true);

    try {
        // Acknowledge the interaction first so Discord does not time it out.
        await interaction.deferReply();

        if (!interaction.channel) {
            throw new Error("The interaction has no writable channel.");
        }

        // Send the separate visible message. This is the operation whose
        // failure should be shown to the user.
        await interaction.channel.send({
            content: text
        });
    } catch (error) {
        console.error("NEXONA TALK SEND ERROR:", error);

        await interaction.editReply({
            content: "I could not send that message in this channel."
        }).catch(() => {});

        return;
    }

    // Deleting the acknowledgement is only cleanup. In some DM/user-install
    // contexts Discord can reject this deletion even though the message was
    // sent successfully, so do not replace a successful message with an
    // error response if cleanup fails.
    await interaction.deleteReply().catch(error => {
        console.error("NEXONA TALK ACKNOWLEDGEMENT CLEANUP ERROR:", error);
    });
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
