import * as dotenv from 'dotenv';
dotenv.config();

import {
  PrismaClient,
  Role,
  GroupRole,
  CommunityRole,
  NotificationType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seeding (Idempotent mode)...');

  const defaultPassword = 'password123';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  // 1. Seed Users
  const usersData = [
    {
      email: 'admin@chatting.com',
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.ADMIN,
    },
    {
      email: 'daniel@chatting.com',
      firstName: 'Daniel',
      lastName: 'Saptianus',
      role: Role.USER,
    },
    {
      email: 'sarah@chatting.com',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: Role.USER,
    },
    {
      email: 'budi@chatting.com',
      firstName: 'Budi',
      lastName: 'Santoso',
      role: Role.USER,
    },
  ];

  const createdUsers: Record<string, any> = {};

  for (const u of usersData) {
    let user = await prisma.user.findUnique({
      where: { email: u.email },
      include: { biodata: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: u.email,
          password: hashedPassword,
          biodata: {
            create: {
              first_name: u.firstName,
              last_name: u.lastName,
              role: u.role,
              is_active: true,
            },
          },
        },
        include: { biodata: true },
      });
      console.log(`   ➕ User created: ${u.email}`);
    } else {
      console.log(`   ℹ️  User already exists: ${u.email}`);
    }
    createdUsers[u.email] = user;
  }

  const admin = createdUsers['admin@chatting.com'];
  const daniel = createdUsers['daniel@chatting.com'];
  const sarah = createdUsers['sarah@chatting.com'];
  const budi = createdUsers['budi@chatting.com'];

  // 2. Seed Community
  const communityName = 'Komunitas ChatSphere Indonesia';
  let community = await prisma.community.findFirst({
    where: { name: communityName },
  });

  if (!community) {
    community = await prisma.community.create({
      data: {
        name: communityName,
        description: 'Wadah silaturahmi, kolaborasi developer, dan pengumuman update aplikasi ChatSphere.',
        created_by_id: admin.id,
      },
    });
    console.log(`   ➕ Community created: ${communityName}`);
  } else {
    console.log(`   ℹ️  Community already exists: ${communityName}`);
  }

  // 3. Seed Community Members
  const communityMembers = [
    { user: admin, role: CommunityRole.COMMUNITY_OWNER },
    { user: daniel, role: CommunityRole.COMMUNITY_ADMIN },
    { user: sarah, role: CommunityRole.COMMUNITY_MEMBER },
    { user: budi, role: CommunityRole.COMMUNITY_MEMBER },
  ];

  for (const cm of communityMembers) {
    const existingCm = await prisma.communityMember.findUnique({
      where: {
        community_id_user_id: {
          community_id: community.id,
          user_id: cm.user.id,
        },
      },
    });

    if (!existingCm) {
      await prisma.communityMember.create({
        data: {
          community_id: community.id,
          user_id: cm.user.id,
          role: cm.role,
        },
      });
      console.log(`   ➕ Added ${cm.user.email} to community as ${cm.role}`);
    }
  }

  // 4. Seed Sub-Groups within Community
  const groupsData = [
    {
      name: 'Pengumuman Resmi',
      description: 'Saluran informasi dan rilis fitur terbaru dari Admin.',
      isAnnouncement: true,
      onlyAdminsCanPost: true,
      creator: admin,
      sampleMessages: [
        { sender: admin, text: 'Halo semuanya! Selamat datang di aplikasi obrolan ChatSphere.' },
        { sender: admin, text: 'Fitur panggilan suara WebRTC dan ekspor chat sekarang sudah aktif!' },
      ],
    },
    {
      name: 'Diskusi & Tanya Jawab',
      description: 'Ruang tanya jawab seputar pengembangan dan penggunaan sistem.',
      isAnnouncement: false,
      onlyAdminsCanPost: false,
      creator: daniel,
      sampleMessages: [
        { sender: daniel, text: 'Halo rekan-rekan! Apakah koneksi suara dan real-time chat berjalan lancar?' },
        { sender: sarah, text: 'Halo Mas Daniel! Saya coba test panggilan dan chat lancar tanpa kendala.' },
        { sender: budi, text: 'Mantap, tampilan checkmark pesan ala WhatsApp juga sudah rapi!' },
      ],
    },
  ];

  for (const g of groupsData) {
    let group = await prisma.group.findFirst({
      where: { name: g.name },
    });

    if (!group) {
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      group = await prisma.group.create({
        data: {
          name: g.name,
          description: g.description,
          invite_code: inviteCode,
          created_by_id: g.creator.id,
          is_announcement: g.isAnnouncement,
          only_admins_can_post: g.onlyAdminsCanPost,
        },
      });
      console.log(`   ➕ Group created: ${g.name}`);

      // Link group to community
      await prisma.communityGroup.create({
        data: {
          community_id: community.id,
          group_id: group.id,
          is_announcement: g.isAnnouncement,
        },
      });
      console.log(`   🔗 Linked group "${g.name}" to community`);

      // Add members to group
      const groupUsers = [admin, daniel, sarah, budi];
      for (const u of groupUsers) {
        const role = u.id === g.creator.id ? GroupRole.OWNER : GroupRole.MEMBER;
        await prisma.groupMember.create({
          data: {
            group_id: group.id,
            user_id: u.id,
            role,
          },
        });
      }

      // Add sample messages
      for (const msg of g.sampleMessages) {
        await prisma.groupMessage.create({
          data: {
            group_id: group.id,
            sender_id: msg.sender.id,
            content: msg.text,
          },
        });
      }
    } else {
      console.log(`   ℹ️  Group already exists: ${g.name}`);
    }
  }

  // 5. Seed Direct Messages (Sample conversation)
  const existingDm = await prisma.directMessage.findFirst({
    where: {
      OR: [
        { sender_id: admin.id, receiver_id: daniel.id },
        { sender_id: daniel.id, receiver_id: admin.id },
      ],
    },
  });

  if (!existingDm) {
    await prisma.directMessage.createMany({
      data: [
        {
          sender_id: admin.id,
          receiver_id: daniel.id,
          content: 'Halo Daniel! Database Neon dan deployment Render sudah terhubung.',
          is_read: true,
          read_at: new Date(),
        },
        {
          sender_id: daniel.id,
          receiver_id: admin.id,
          content: 'Siap min! Semua data awal dan seeder sudah berjalan otomatis.',
          is_read: true,
          read_at: new Date(),
        },
      ],
    });
    console.log(`   ➕ Direct messages seeded between Admin and Daniel`);
  }

  // 6. Seed Welcome Notification for Daniel
  const existingNotif = await prisma.notification.findFirst({
    where: { user_id: daniel.id },
  });

  if (!existingNotif) {
    await prisma.notification.create({
      data: {
        user_id: daniel.id,
        type: NotificationType.USER_REGISTERED,
        title: 'Selamat Datang di ChatSphere!',
        message: 'Akun Anda telah aktif. Anda dapat mulai mengobrol, bergabung ke komunitas, dan mencoba panggilan suara.',
        is_read: false,
      },
    });
    console.log(`   ➕ Welcome notification created for Daniel`);
  }

  console.log('\n✨ Database seeding completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   - Total Users: ${await prisma.user.count()}`);
  console.log(`   - Total Communities: ${await prisma.community.count()}`);
  console.log(`   - Total Groups: ${await prisma.group.count()}`);
  console.log(`   - Total Group Messages: ${await prisma.groupMessage.count()}`);
  console.log(`   - Total Direct Messages: ${await prisma.directMessage.count()}\n`);
  console.log('🔑 Default Accounts (Password for all: password123):');
  console.log('   1. Super Admin : admin@chatting.com');
  console.log('   2. Daniel      : daniel@chatting.com');
  console.log('   3. Sarah       : sarah@chatting.com');
  console.log('   4. Budi        : budi@chatting.com\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
