const { execSync } = require('child_process');

try {
    console.log('Installing dependencies...');

    // Install dependencies in the project root (/node_modules/)
    //execSync('npm install', { stdio: 'inherit' });

    // Install yarn.
    execSync('npm install -g yarn', { stdio: 'inherit' });

    // yarn install dependencies
    execSync('yarn install', { stdio: 'inherit' });

    // Install dependencies in the chat-server container (if needed)
    //execSync('podman compose --file podman-compose.yaml run --rm chat-server npm install', { stdio: 'inherit' });

    console.log('Starting Redis...');
    execSync('podman compose --file podman-compose.yaml up -d redis', { stdio: 'inherit' });

    console.log('Starting Chat Server...');
    execSync('podman compose --file podman-compose.yaml up chat-server', { stdio: 'inherit' });

    console.log('All services started successfully!');
    } catch (err) {
    console.error('Error starting services:', err);
    process.exit(1);
}