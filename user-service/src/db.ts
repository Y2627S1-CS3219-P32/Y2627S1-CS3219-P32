import { drizzle } from 'drizzle-orm/node-sqlite';
import { eq } from 'drizzle-orm';

import { usersTable, User } from './db/schema';

export const db = drizzle("./users.sqlite");

export function getAllUsers(): User[] {
  return db.select().from(usersTable).all();
}

function seedUserTableIfEmpty(): void {
    const currentUsers = getAllUsers()

    if (currentUsers.length == 0) {
        db.insert(usersTable).values([
            {
                name: "admin",
                email: "admin@foc.com",
                role: "admin",
            },
            {
                name: "John Doe",
                email: "john@u.nus.edu",
                role: "student",
            },
        ]).run()
    }  
}

seedUserTableIfEmpty()