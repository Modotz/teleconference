'use client';

import { useState } from 'react';
import { X, Plus, Trash2, ChevronUp, Check, BarChart3, MessageCircleQuestion } from 'lucide-react';

interface Poll {
  id: string;
  question: string;
  closed: boolean;
  options: { text: string; count: number }[];
}
interface Question {
  id: string;
  text: string;
  authorName: string;
  upvotes: number;
  answered: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  isModerator: boolean;
  polls: Poll[];
  questions: Question[];
  myVotes: Map<string, number>;
  myUpvotes: Set<string>;
  onCreatePoll: (question: string, options: string[]) => void;
  onVote: (pollId: string, idx: number) => void;
  onClosePoll: (pollId: string) => void;
  onAsk: (text: string) => void;
  onUpvote: (qId: string) => void;
  onAnswer: (qId: string) => void;
}

export default function PollsPanel({
  open,
  onClose,
  isModerator,
  polls,
  questions,
  myVotes,
  myUpvotes,
  onCreatePoll,
  onVote,
  onClosePoll,
  onAsk,
  onUpvote,
  onAnswer,
}: Props) {
  const [tab, setTab] = useState<'qa' | 'polls'>('qa');

  return (
    <>
      <aside
        className={`
          bg-slate-900 border-slate-800 flex flex-col
          transition-all duration-200
          fixed inset-y-0 right-0 z-30 w-full max-w-sm
          md:static md:max-w-none md:inset-auto md:z-auto
          ${
            open
              ? 'translate-x-0 md:w-80 border-l'
              : 'translate-x-full md:translate-x-0 md:w-0 md:border-l-0 md:overflow-hidden'
          }
        `}
      >
        <div className="px-4 py-3 border-b border-slate-800 font-medium flex items-center justify-between">
          <span>Polls &amp; Q&amp;A</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 text-sm">
          <button
            onClick={() => setTab('qa')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 ${
              tab === 'qa'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-slate-400'
            }`}
          >
            <MessageCircleQuestion className="w-4 h-4" /> Q&amp;A
          </button>
          <button
            onClick={() => setTab('polls')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 ${
              tab === 'polls'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-slate-400'
            }`}
          >
            <BarChart3 className="w-4 h-4" /> Polls
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'qa' ? (
            <QATab
              questions={questions}
              myUpvotes={myUpvotes}
              isModerator={isModerator}
              onAsk={onAsk}
              onUpvote={onUpvote}
              onAnswer={onAnswer}
            />
          ) : (
            <PollsTab
              polls={polls}
              myVotes={myVotes}
              isModerator={isModerator}
              onCreatePoll={onCreatePoll}
              onVote={onVote}
              onClosePoll={onClosePoll}
            />
          )}
        </div>
      </aside>

      {open && (
        <div
          onClick={onClose}
          className="md:hidden fixed inset-0 bg-black/50 z-20"
          aria-hidden
        />
      )}
    </>
  );
}

function QATab({
  questions,
  myUpvotes,
  isModerator,
  onAsk,
  onUpvote,
  onAnswer,
}: {
  questions: Question[];
  myUpvotes: Set<string>;
  isModerator: boolean;
  onAsk: (t: string) => void;
  onUpvote: (id: string) => void;
  onAnswer: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const sorted = [...questions].sort((a, b) => {
    if (a.answered !== b.answered) return a.answered ? 1 : -1;
    return b.upvotes - a.upvotes;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sorted.length === 0 ? (
          <div className="text-slate-500 text-center text-sm py-8">
            No questions yet. Ask one below.
          </div>
        ) : (
          sorted.map((q) => (
            <div
              key={q.id}
              className={`flex gap-2 p-2.5 rounded-lg border ${
                q.answered
                  ? 'border-slate-800 bg-slate-800/40 opacity-70'
                  : 'border-slate-700 bg-slate-800/60'
              }`}
            >
              <button
                onClick={() => onUpvote(q.id)}
                className={`shrink-0 flex flex-col items-center justify-center w-10 rounded-md ${
                  myUpvotes.has(q.id)
                    ? 'bg-blue-600/30 text-blue-300'
                    : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <ChevronUp className="w-4 h-4" />
                <span className="text-xs font-semibold">{q.upvotes}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words">{q.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-500">{q.authorName}</span>
                  {q.answered && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-300 rounded">
                      Answered
                    </span>
                  )}
                  {isModerator && (
                    <button
                      onClick={() => onAnswer(q.id)}
                      className="text-xs text-slate-400 hover:text-slate-200 ml-auto"
                    >
                      {q.answered ? 'Reopen' : 'Mark answered'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) {
            onAsk(t);
            setText('');
          }
        }}
        className="p-3 border-t border-slate-800 flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask a question…"
          maxLength={300}
          className="flex-1 min-w-0 px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

function PollsTab({
  polls,
  myVotes,
  isModerator,
  onCreatePoll,
  onVote,
  onClosePoll,
}: {
  polls: Poll[];
  myVotes: Map<string, number>;
  isModerator: boolean;
  onCreatePoll: (q: string, opts: string[]) => void;
  onVote: (pollId: string, idx: number) => void;
  onClosePoll: (pollId: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [creating, setCreating] = useState(false);

  function submit() {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) return;
    onCreatePoll(question.trim(), opts);
    setQuestion('');
    setOptions(['', '']);
    setCreating(false);
  }

  return (
    <div className="p-3 space-y-3">
      {isModerator &&
        (creating ? (
          <div className="p-3 rounded-lg border border-slate-700 bg-slate-800/60 space-y-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Poll question"
              className="w-full px-3 py-2 bg-slate-900 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={o}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((x, j) => (j === i ? e.target.value : x))
                    )
                  }
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-900 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                {options.length > 2 && (
                  <button
                    onClick={() =>
                      setOptions((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="p-2 text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add option
              </button>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setCreating(false)}
                className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded"
              >
                Launch poll
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded"
          >
            <Plus className="w-4 h-4" /> Create poll
          </button>
        ))}

      {polls.length === 0 && !creating && (
        <div className="text-slate-500 text-center text-sm py-8">
          No polls yet.
        </div>
      )}

      {[...polls].reverse().map((poll) => {
        const total = poll.options.reduce((s, o) => s + o.count, 0);
        const myVote = myVotes.get(poll.id);
        return (
          <div
            key={poll.id}
            className="p-3 rounded-lg border border-slate-700 bg-slate-800/60"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{poll.question}</p>
              {poll.closed && (
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded shrink-0">
                  Closed
                </span>
              )}
            </div>
            <div className="mt-2 space-y-1.5">
              {poll.options.map((o, i) => {
                const pct = total ? Math.round((o.count / total) * 100) : 0;
                const mine = myVote === i;
                return (
                  <button
                    key={i}
                    onClick={() => !poll.closed && onVote(poll.id, i)}
                    disabled={poll.closed}
                    className="w-full text-left relative overflow-hidden rounded-md border border-slate-700 disabled:cursor-default"
                  >
                    <div
                      className={`absolute inset-y-0 left-0 ${
                        mine ? 'bg-blue-600/40' : 'bg-slate-700/50'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="flex items-center gap-1.5">
                        {mine && <Check className="w-3.5 h-3.5 text-blue-300" />}
                        {o.text}
                      </span>
                      <span className="text-xs text-slate-400">
                        {o.count} · {pct}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-500">{total} votes</span>
              {isModerator && !poll.closed && (
                <button
                  onClick={() => onClosePoll(poll.id)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Close poll
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
