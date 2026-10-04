const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ApplicationIntegrationType,
    InteractionContextType
} = require("discord.js");

const OWNER_ID = "1193602200644091957";

const commands = [
    new SlashCommandBuilder()
        .setName("talk")
        .setDescription("يقول رسالة بدل من البوت")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("اكتب النص اللي تبي البوت يرسله")
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
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "talk") return;

    const isOwner = interaction.user.id === OWNER_ID;
    const canManageMessages = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
    );

    if (!isOwner && !canManageMessages) {
        return interaction.reply({
            content: "أنت ما عندك صلاحية استخدام هذا الأمر.",
            ephemeral: true
        });
    }

    const text = interaction.options.getString("text", true);

    try {
        if (interaction.guild) {
            await interaction.deferReply({ ephemeral: true });
            await interaction.channel.send({ content: text });
            await interaction.deleteReply().catch(() => {});
            return;
        }

        await interaction.reply({ content: text });
        return;
    } catch (error) {
        console.error("Talk command error:", error);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: "حدث خطأ أثناء إرسال الرسالة."
            }).catch(() => {});
            return;
        }

        await interaction.reply({
            content: "حدث خطأ أثناء إرسال الرسالة.",
            ephemeral: true
        }).catch(() => {});
    }
}

module.exports = {
    commands,
    handleInteraction
};
