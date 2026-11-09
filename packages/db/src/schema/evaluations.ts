import type { SusAnswers } from '@monibot/types'
import { index, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { tutoringSessions } from './sessions'

export const userEvaluations = pgTable(
  'user_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => tutoringSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    susAnswers: jsonb('sus_answers').$type<SusAnswers>().notNull(),
    susCalculatedScore: real('sus_calculated_score').notNull(),
    tamPerceivedUsefulness: real('tam_perceived_usefulness').notNull(),
    tamPerceivedEaseOfUse: real('tam_perceived_ease_of_use').notNull(),
    avatarNaturalnessScore: real('avatar_naturalness_score'),
    comments: text('comments').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_evaluations_session_id_idx').on(table.sessionId)]
)

export type UserEvaluationRow = typeof userEvaluations.$inferSelect
export type NewUserEvaluationRow = typeof userEvaluations.$inferInsert
