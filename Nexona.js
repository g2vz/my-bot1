const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

const talk = require("./talk");
const afk = require("./afk");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const allCommands = [...talk.commands, ...afk.commands];

client.once("ready", async () => {
    console.log("--------------------------------");
    console.log("Nexona is online!");
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log("--------------------------------");

    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: allCommands.map(command => command.toJSON()) }
        );

        console.log(`Registered ${allCommands.length} slash command(s).`);
        allCommands.forEach(cmd => console.log(`  /${cmd.name}`));
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }
});

client.on("interactionCreate", async interaction => {
    if (talk.handleInteraction) {
        await talk.handleInteraction(interaction);
    }

    if (afk.handleInteraction) {
        await afk.handleInteraction(interaction);
    }
});

if (!TOKEN) {
    console.error("DISCORD_TOKEN is missing.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("CLIENT_ID is missing.");
    process.exit(1);
}

client.login(TOKEN);
