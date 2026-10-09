const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder
} = require("discord.js");

const {
    joinVoiceChannel,
    getVoiceConnection
} = require("@discordjs/voice");

const OWNER_ID = "1486246219243323503";

const COMMAND_NAME = "mambo-sleep";
const BUTTON_ID = "mambo_sleep_leave";
const SELECT_ID = "mambo_sleep_select";

const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("خل مامبو تنام في فويس")
    .addChannelOption(option =>
        option
            .setName("voice")
            .setDescription("الفويس اللي تبي مامبو تنام فيه")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
    );

function canControl(interaction) {
    if (interaction.user.id === OWNER_ID) {
        return true;
    }

    const permissions = interaction.memberPermissions;

    if (!permissions) {
        return false;
    }

    return (
        permissions.has(PermissionFlagsBits.MoveMembers) ||
        permissions.has(PermissionFlagsBits.Administrator) ||
        permissions.has(PermissionFlagsBits.ManageGuild)
    );
}

function permissionMessage() {
    return "ما تقدر تستخدم الأمر هذا. تحتاج صلاحية Move Members أو صلاحيات المشرف.";
}

function getCurrentVoiceChannel(guild) {
    return guild.members.me?.voice?.channel ?? null;
}

async function showLeaveConfirmation(interaction, channel) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_ID)
            .setLabel("اضغط للتأكيد")
            .setStyle(ButtonStyle.Danger)
    );

    const message =
        "مامبو موجوده ب فويس اتوقع انك اعمى، او تبيها تطلع؟\n" +
        `الفويس الحالي: **${channel.name}**\n` +
        "اضغط للتأكيد (خل مامبو تطلع من الفويس)";

    await interaction.reply({
        content: message,
        components: [row],
        ephemeral: true
    });
}

async function putMamboToSleep(interaction, channel) {
    const guild = interaction.guild;

    if (!guild) {
        return interaction.reply({
            content: "هذا الأمر يشتغل داخل السيرفر فقط.",
            ephemeral: true
        });
    }

    if (!channel || channel.type !== ChannelType.GuildVoice) {
        return interaction.reply({
            content: "اختر فويس  .",
            ephemeral: true
        });
    }

    const botMember = guild.members.me;

    if (!botMember) {
        return interaction.reply({
            content: "ما قدرت أتحقق من عضوية مامبو في السيرفر.",
            ephemeral: true
        });
    }

    const botPermissions = channel.permissionsFor(botMember);

    if (
        !botPermissions ||
        !botPermissions.has(PermissionFlagsBits.Connect)
    ) {
        return interaction.reply({
            content: "مامبو ما عندها صلاحية Connect في الفويس المحدد.",
            ephemeral: true
        });
    }

    if (
        channel.userLimit > 0 &&
        channel.members.size >= channel.userLimit
    ) {
        return interaction.reply({
            content: "الفويس ممتلئ. فض مكان لمامبو ياعبد.",
            ephemeral: true
        });
    }

    try {
        const oldConnection = getVoiceConnection(guild.id);

        if (oldConnection) {
            oldConnection.destroy();
        }

        joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });

        await interaction.reply({
            content: `مامبو راحت تنام في <#${channel.id}>. لاحد يزعجها.`,
            ephemeral: true
        });

    } catch (error) {
        console.error("Mambo sleep error:", error);

        const message =
            "ما قدرت أدخل مامبو للفويس. تأكد من صلاحيات البوت وحاول مرة ثانية.";

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: message,
                ephemeral: true
            }).catch(() => {});
        } else {
            await interaction.reply({
                content: message,
                ephemeral: true
            }).catch(() => {});
        }
    }
}

async function handleInteraction(interaction) {
    if (
        !interaction.isChatInputCommand() &&
        !interaction.isButton() &&
        !interaction.isChannelSelectMenu()
    ) {
        return false;
    }

    const isSleepCommand =
        interaction.isChatInputCommand() &&
        interaction.commandName === COMMAND_NAME;

    const isSleepButton =
        interaction.isButton() &&
        interaction.customId === BUTTON_ID;

    const isSleepSelect =
        interaction.isChannelSelectMenu() &&
        interaction.customId === SELECT_ID;

    if (!isSleepCommand && !isSleepButton && !isSleepSelect) {
        return false;
    }

    if (!canControl(interaction)) {
        const message = permissionMessage();

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: message,
                ephemeral: true
            }).catch(() => {});
        } else {
            await interaction.reply({
                content: message,
                ephemeral: true
            }).catch(() => {});
        }

        return true;
    }

    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "هذا الأمر متاح داخل السيرفر فقط.",
            ephemeral: true
        });
        return true;
    }

    // اختيار الفويس من قائمة القنوات
    if (isSleepSelect) {
        const channel = interaction.channels.first();

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            await interaction.reply({
                content: "اختر فويس  .",
                ephemeral: true
            });
            return true;
        }

        const currentChannel = getCurrentVoiceChannel(interaction.guild);

        if (currentChannel) {
            await showLeaveConfirmation(interaction, currentChannel);
            return true;
        }

        await putMamboToSleep(interaction, channel);
        return true;
    }

    // زر إخراج مامبو من الفويس
    if (isSleepButton) {
        const currentChannel = getCurrentVoiceChannel(interaction.guild);

        if (!currentChannel) {
            await interaction.update({
                content: "مامبو طلعت من الفويس اولردي.",
                components: []
            });
            return true;
        }

        try {
            const connection = getVoiceConnection(interaction.guildId);

            if (connection) {
                connection.destroy();
            } else {
                await interaction.guild.members.me.voice.disconnect();
            }

            await interaction.update({
                content: "تم إخراج مامبو من الفويس. انتهى وقت النوم.",
                components: []
            });

        } catch (error) {
            console.error("Mambo leave error:", error);

            await interaction.reply({
                content: "ما قدرت أطلع مامبو من الفويس. تحقق من صلاحيات البوت.",
                ephemeral: true
            }).catch(() => {});
        }

        return true;
    }

    // أمر /mambo-sleep
    if (isSleepCommand) {
        const currentChannel = getCurrentVoiceChannel(interaction.guild);

        if (currentChannel) {
            await showLeaveConfirmation(interaction, currentChannel);
            return true;
        }

        const selectedChannel = interaction.options.getChannel("voice");

        if (selectedChannel) {
            await putMamboToSleep(interaction, selectedChannel);
            return true;
        }

        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(SELECT_ID)
                .setPlaceholder("اختار الفويس اللي تنام فيه مامبو")
                .setChannelTypes(ChannelType.GuildVoice)
                .setMinValues(1)
                .setMaxValues(1)
        );

        await interaction.reply({
            content: "وين تبي مامبو تنام؟ اختر الفويس:",
            components: [row],
            ephemeral: true
        });

        return true;
    }

    return false;
}

module.exports = {
    commands: [command],
    handleInteraction
};