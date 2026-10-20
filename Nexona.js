
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

const talk = require("./talk");
const mamboSleep = require("./mambo-sleep");
const automod = require("./automod");
const roleCommand = require("./role");
const scan = require("./scan");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("DISCORD_TOKEN or CLIENT_ID is missing.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.on("messageCreate", automod.handleMessage);

const commandGroups = [
    ...(talk.commands || []),
    ...(mamboSleep.commands || []),
    ...(roleCommand.commands || [])
];

const seenCommandNames = new Set();

const allCommands = commandGroups.filter(command => {
    if (!command?.name || seenCommandNames.has(command.name)) {
        return false;
    }

    seenCommandNames.add(command.name);
    return true;
});

client.once("clientReady", async () => {
    console.log(`Mambo is online as ${client.user.tag}`);

    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: allCommands.map(command =>
                    typeof command.toJSON === "function"
                        ? command.toJSON()
                        : command
                )
            }
        );

        console.log(
            `Registered ${allCommands.length} slash commands.`
        );
    } catch (error) {
        console.error("Command registration failed:", error);
    }
});

client.on("interactionCreate", async interaction => {
    try {
        if (await roleCommand.handleInteraction(interaction)) return;

        if (await mamboSleep.handleInteraction(interaction)) return;

        if (interaction.isChatInputCommand()) {
            if (await talk.handleInteraction(interaction, client)) return;
        }
    } catch (error) {
        console.error("Interaction error:", error);

        const message = "صار خطأ أثناء تنفيذ الأمر.";

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: message,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: message,
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error("Failed to send error response:", replyError);
        }
    }
});

client.on("error", console.error);

process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

client.login(TOKEN);
