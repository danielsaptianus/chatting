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
  console.log('🌱 Starting database seeding (Multi-Role SRS Idempotent mode)...');

  const defaultPassword = 'password123';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  // 1. Seed Users (Super Admin, Group Admin, and Regular Users)
  const usersData = [
    {
      email: 'superadmin@chatting.com',
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.SUPER_ADMIN,
      phone: '+628111222333',
      bio: 'Platform Super Administrator with global system management.',
    },
    {
      email: 'admin@chatting.com',
      firstName: 'Admin',
      lastName: 'Grup',
      role: Role.ADMIN,
      phone: '+628123456780',
      bio: 'Administrator Grup khusus saluran Pengumuman Resmi ChatSphere.',
    },
    {
      email: 'daniel@chatting.com',
      firstName: 'Daniel',
      lastName: 'Saptianus',
      role: Role.USER,
      phone: '+628123456789',
      bio: 'Fullstack Developer & Community Leader.',
    },
    {
      email: 'sarah@chatting.com',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: Role.USER,
      phone: '+628567890123',
      bio: 'Product Designer & Audio Enthusiast.',
    },
    {
      email: 'budi@chatting.com',
      firstName: 'Budi',
      lastName: 'Santoso',
      role: Role.USER,
      phone: '+628789012345',
      bio: 'Software QA & DevOps Specialist.',
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
              phone: u.phone,
              bio: u.bio,
              is_active: true,
            },
          },
        },
        include: { biodata: true },
      });
      console.log(`   ➕ User created: ${u.email} (${u.role})`);
    } else {
      // Upsert role/phone/bio to keep in sync with SRS
      await prisma.biodata.upsert({
        where: { user_id: user.id },
        create: {
          user_id: user.id,
          first_name: u.firstName,
          last_name: u.lastName,
          role: u.role,
          phone: u.phone,
          bio: u.bio,
          is_active: true,
        },
        update: {
          role: u.role,
          phone: user.biodata?.phone || u.phone,
          bio: user.biodata?.bio || u.bio,
        },
      });
      console.log(`   ℹ️  User synced: ${u.email} (${u.role})`);
    }
    createdUsers[u.email] = user;
  }

  const superAdmin = createdUsers['superadmin@chatting.com'];
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
        created_by_id: superAdmin.id,
      },
    });
    console.log(`   ➕ Community created: ${communityName}`);
  } else {
    console.log(`   ℹ️  Community already exists: ${communityName}`);
  }

  // 3. Seed Community Members
  const communityMembers = [
    { user: superAdmin, role: CommunityRole.COMMUNITY_OWNER },
    { user: admin, role: CommunityRole.COMMUNITY_ADMIN },
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
      creator: superAdmin,
      sampleMessages: [
        { sender: superAdmin, text: 'Halo semuanya! Selamat datang di aplikasi obrolan ChatSphere.' },
        { sender: admin, text: 'Hierarki multi-role, isolasi akun per grup, dan timer dering 30 detik sekarang telah aktif!' },
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
        { sender: sarah, text: 'Halo Mas Daniel! Saya coba upload avatar dan test audio call lancar tanpa kendala.' },
        { sender: budi, text: 'Mantap, tampilan checkmark pesan ala WhatsApp dan kartu profil publik juga sudah rapi!' },
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
      const groupUsers = [superAdmin, admin, daniel, sarah, budi];
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

    // Bind admin@chatting.com to manage the announcement group (Scoped Tenancy: managed_group_id)
    if (g.isAnnouncement) {
      await prisma.user.update({
        where: { id: admin.id },
        data: { managed_group_id: group.id },
      });
      console.log(`   🔒 Scoped Admin (${admin.email}) assigned to manage group "${group.name}" (#${group.id})`);
    }
  }

  // 5. Seed Direct Messages (Sample conversation)
  const existingDm = await prisma.directMessage.findFirst({
    where: {
      OR: [
        { sender_id: superAdmin.id, receiver_id: daniel.id },
        { sender_id: daniel.id, receiver_id: superAdmin.id },
      ],
    },
  });

  if (!existingDm) {
    await prisma.directMessage.createMany({
      data: [
        {
          sender_id: superAdmin.id,
          receiver_id: daniel.id,
          content: 'Halo Daniel! Database Neon dan deployment Render sudah terhubung dengan skema multi-role.',
          is_read: true,
          read_at: new Date(),
        },
        {
          sender_id: daniel.id,
          receiver_id: superAdmin.id,
          content: 'Siap! Sistem isolasi akun dan profil biodata avatar juga sudah siap diuji.',
          is_read: true,
          read_at: new Date(),
        },
      ],
    });
    console.log(`   ➕ Direct messages seeded between Super Admin and Daniel`);
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
        message: 'Akun Anda telah aktif dengan akses obrolan, komunitas, profil avatar, dan WebRTC voice call.',
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
  console.log('   1. Super Admin : superadmin@chatting.com (SUPER_ADMIN)');
  console.log('   2. Group Admin : admin@chatting.com (ADMIN - Scoped to Announcement Group)');
  console.log('   3. Daniel      : daniel@chatting.com (USER)');
  console.log('   4. Sarah       : sarah@chatting.com (USER)');
  console.log('   5. Budi        : budi@chatting.com (USER)\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
