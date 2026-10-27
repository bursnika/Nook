import { buildSchema } from 'graphql';

/** The GraphQL face of Nook: reading and moving tasks and events, plus live updates of both. */
export const typeDefs = /* GraphQL */ `
  type Task {
    id: ID!
    workspaceId: ID!
    title: String!
    description: String
    status: String!
    priority: String!
    dueDate: String
    position: Float!
    pageId: ID
    assigneeId: ID
    commentCount: Int
    attachmentCount: Int
  }

  type CalendarEvent {
    id: ID!
    workspaceId: ID!
    title: String!
    description: String
    startsAt: String!
    endsAt: String!
    allDay: Boolean!
  }

  type TaskChange {
    kind: String!
    taskId: ID!
    task: Task
  }

  type EventChange {
    kind: String!
    eventId: ID!
    event: CalendarEvent
  }

  type Query {
    tasks(workspaceId: ID!, status: String): [Task!]!
    events(workspaceId: ID!, from: String!, to: String!): [CalendarEvent!]!
  }

  type Mutation {
    "Moves a task to a column of the board and, optionally, to a position inside it."
    moveTask(workspaceId: ID!, id: ID!, status: String!, position: Float): Task!
  }

  type Subscription {
    taskChanged(workspaceId: ID!): TaskChange!
    eventChanged(workspaceId: ID!): EventChange!
  }
`;

export const schema = buildSchema(typeDefs);
