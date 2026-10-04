const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

const talk = require("./talk");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

client.once("ready", async () => {
    console.log("--------------------------------");
    console.log("Nexona is online!");
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log("--------------------------------");

    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        const commandData = talk.commands.map(command => command.toJSON());

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commandData }
        );

        console.log(`Registered ${commandData.length} slash command(s).`);
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }
});

client.on("interactionCreate", async interaction => {
    if (talk.handleInteraction) {
        await talk.handleInteraction(interaction);
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
