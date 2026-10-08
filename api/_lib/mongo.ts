import { MongoClient } from 'mongodb';

const globalMongo = globalThis as typeof globalThis & {
  kyonMongoClient?: Promise<MongoClient>;
};

function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured.');
  return new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 }).connect();
}

export async function getDatabase() {
  const connection = globalMongo.kyonMongoClient ??= connectMongo();
  const client = await connection.catch((error: unknown) => {
    if (globalMongo.kyonMongoClient === connection) delete globalMongo.kyonMongoClient;
    throw error;
  });
  return client.db(process.env.MONGODB_DB || 'kyon');
}
