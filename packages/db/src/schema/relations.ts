import { relations } from 'drizzle-orm'
import { accounts, authSessions, users } from './auth'
import { userEvaluations } from './evaluations'
import { knowledgeChunks, knowledgeDocuments } from './knowledge'
import { interactionLogs, tutoringSessions } from './sessions'

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(authSessions),
  accounts: many(accounts),
  evaluations: many(userEvaluations),
}))

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, { fields: [authSessions.userId], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ many }) => ({
  chunks: many(knowledgeChunks),
}))

export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [knowledgeChunks.documentId],
    references: [knowledgeDocuments.id],
  }),
}))

export const tutoringSessionsRelations = relations(tutoringSessions, ({ many }) => ({
  interactionLogs: many(interactionLogs),
  evaluations: many(userEvaluations),
}))

export const interactionLogsRelations = relations(interactionLogs, ({ one }) => ({
  session: one(tutoringSessions, {
    fields: [interactionLogs.sessionId],
    references: [tutoringSessions.id],
  }),
}))

export const userEvaluationsRelations = relations(userEvaluations, ({ one }) => ({
  session: one(tutoringSessions, {
    fields: [userEvaluations.sessionId],
    references: [tutoringSessions.id],
  }),
  user: one(users, { fields: [userEvaluations.userId], references: [users.id] }),
}))
