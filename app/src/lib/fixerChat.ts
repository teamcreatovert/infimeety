import { diagnose, FIXER_ID } from './fixer';
import { useChannels } from '@/stores/channels';
import { useMessages, type LocalMessage } from '@/stores/messages';

const localId = () => `~fixer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Shows your question and, after the checks, Fixer's private answer in the room. */
export function askFixer(roomId: string, userId: string, question: string) {
  const base = { roomId, attachments: [], replyTo: null, reactions: {}, editedAt: null, local: true };
  const asked: LocalMessage = { ...base, id: localId(), userId, content: question, createdAt: Date.now() };
  useMessages.getState().addLocal(asked);
  // Fixer's name and badge, even where its bot list hasn't loaded.
  useChannels.getState().upsertUser({ id: FIXER_ID, name: 'Fixer', username: null, avatarUrl: null, bot: true });
  void diagnose(question).then((report) => {
    useMessages.getState().addLocal({ ...base, id: localId(), userId: FIXER_ID, content: report.intro, replyTo: asked.id, createdAt: Date.now(), fixer: report });
  });
}
