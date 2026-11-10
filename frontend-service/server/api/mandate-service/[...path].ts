import { agentProxy } from '../../services/agent-service/proxy';
export default defineEventHandler((event) => agentProxy(event, 'mandate'));
