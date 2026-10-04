const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus,
    entersState
} = require("@discordjs/voice");

const commands = [
    new SlashCommandBuilder()
        .setName("afk24-7")
        .setDescription("خلي مامبو تنام بالفويس")
        .addChannelOption(option =>
            option
                .setName("voice")
                .setDescription("اختار الفويس الي تبي مامبو تنام فيه")
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true)
        )
];

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "afk24-7") return;

    const voiceChannel = interaction.options.getChannel("voice", true);

    if (!interaction.guild) {
        return interaction.reply({
            content: "هذا الأمر يشتغل بس داخل السيرفر.",
            ephemeral: true
        });
    }

    const existingConnection = getVoiceConnection(interaction.guild.id);

    // If the bot is already in a VC, disconnect it.
    if (existingConnection) {
        existingConnection.destroy();

        return interaction.reply({
            content: "تم فصل مامبو من الفويس.",
            ephemeral: true
        });
    }

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

        return interaction.reply({
            content: `مامبو نايمه الآن في <#${voiceChannel.id}>.`,
            ephemeral: true
        });
    } catch (error) {
        console.error("AFK24-7 error:", error);

        return interaction.reply({
            content: "ما قدرت أروح للفويس هذا. تأكد من صلاحياتي ووجوده.",
            ephemeral: true
        });
    }
}

module.exports = {
    commands,
    handleInteraction
};
