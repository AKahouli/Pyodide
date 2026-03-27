db.users.insertOne({
  email: 'admin@yellowsys.fr',
  passwordHash: '$2b$12$rw9FdZAWEEDw0Y/vBFFpweCEvhCZ6oYmKGJNc21YthjjuEfRCynYC',
  emailVerified: true,
  profile: {
    firstName: 'Admin',
    lastName: 'Yellowsys'
  },
  roles: [ObjectId('69bbe143a76c709b8925e692')],
  planId: ObjectId('69bbe143a76c709b8925e696'),
  planSlug: 'unlimited',
  status: 'active',
  profileComplete: true,
  createdAt: new Date(),
  updatedAt: new Date()
});
