import { createGameServer } from './app.js';

const { httpServer } = createGameServer();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
httpServer.listen(PORT, () => console.log(`Server listening on :${PORT}`));
