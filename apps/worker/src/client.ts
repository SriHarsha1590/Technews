import { Client, Connection } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';

export async function getClient(): Promise<Client> {
  const temporal = loadClientConnectConfig();
  const connection = await Connection.connect(temporal.connectionOptions);
  return new Client({ connection, namespace: temporal.namespace });
}
