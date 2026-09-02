import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seeding...\n');

  console.log('🗑️  Clearing existing data...');
  await prisma.notification.deleteMany();
  await prisma.directMessage.deleteMany();
  await prisma.groupMessage.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.biodata.deleteMany();
  await prisma.user.deleteMany();

  const defaultPassword = 'password123';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  // Seed Admin User
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@chatting.com',
      password: hashedPassword,
      biodata: {
        create: {
          first_name: 'Super',
          last_name: 'Admin',
          role: Role.ADMIN,
          is_active: true,
        },
      },
    },
    include: { biodata: true },
  });

  // Seed Normal User
  const memberUser = await prisma.user.create({
    data: {
      email: 'user@chatting.com',
      password: hashedPassword,
      biodata: {
        create: {
          first_name: 'John',
          last_name: 'Doe',
          role: Role.USER,
          is_active: true,
        },
      },
    },
    include: { biodata: true },
  });

  console.log('\n✨ Database seeding completed!\n');
  console.log('📊 Summary:');
  console.log(`   - Users: ${await prisma.user.count()}`);
  console.log('🔑 Default Credentials:');
  console.log(`   Admin: ${adminUser.email} / ${defaultPassword}`);
  console.log(`   User: ${memberUser.email} / ${defaultPassword}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
