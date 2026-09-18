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
        // A slash command must be acknowledged quickly. Use a normal,
        // non-ephemeral acknowledgement because ephemeral replies are not
        // reliable in DM/private-channel contexts.
        await interaction.deferReply();

        // Send a separate ordinary message in both guilds and DMs.
        if (!interaction.channel) {
            throw new Error("The interaction has no writable channel.");
        }

        await interaction.channel.send({
            content: text
        });

        // Remove only the command acknowledgement. The separate message
        // above remains visible.
        await interaction.deleteReply().catch(() => {});
    } catch (error) {
        console.error("NEXONA TALK ERROR:", error);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: "I could not send that message in this channel."
            }).catch(() => {});
        } else {
            await interaction.reply({
                content: "I could not send that message in this channel."
            }).catch(() => {});
        }
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
