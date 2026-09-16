import * as dotenv from 'dotenv';
dotenv.config();

import {
  PrismaClient,
  Role,
  GroupRole,
  CommunityRole,
  NotificationType,
  CallType,
  CallStatus,
  CallMediaType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seeding (SRS V2 Hierarchical Region Multi-Tenancy)...');

  const defaultPassword = 'password123';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  // 1. Seed Regions (FR-REG-01, BR-TENANT-01)
  const regionA = await prisma.region.upsert({
    where: { code: 'REG-A' },
    create: {
      name: 'Region A',
      code: 'REG-A',
      description: 'Wilayah Operasional Region A',
    },
    update: {
      name: 'Region A',
      description: 'Wilayah Operasional Region A',
    },
  });
  console.log(`   📍 Region upserted: ${regionA.name} (${regionA.code})`);

  const regionB = await prisma.region.upsert({
    where: { code: 'REG-B' },
    create: {
      name: 'Region B',
      code: 'REG-B',
      description: 'Wilayah Operasional Region B',
    },
    update: {
      name: 'Region B',
      description: 'Wilayah Operasional Region B',
    },
  });
  console.log(`   📍 Region upserted: ${regionB.name} (${regionB.code})`);

  // 2. Seed Users
  // Super Admin: Global Access
  // Region Admin A: Strictly 1 Admin managing Region A (BR-TENANT-01)
  // Region Admin B: Strictly 1 Admin managing Region B (BR-TENANT-01)
  // Users in Region A: Daniel, Sarah
  // Users in Region B: Budi
  const usersData = [
    {
      email: 'superadmin@chatting.com',
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.SUPER_ADMIN,
      regionId: null,
      managedRegionId: null,
      phone: '+628111222333',
      bio: 'Platform Super Administrator with global multi-region authority.',
    },
    {
      email: 'admin.a@chatting.com',
      firstName: 'Admin',
      lastName: 'Region A',
      role: Role.REGION_ADMIN,
      regionId: regionA.id,
      managedRegionId: regionA.id,
      phone: '+628123456701',
      bio: 'Administrator Wilayah Region A yang mengelola user, grup, dan komunitas Region A.',
    },
    {
      email: 'admin.b@chatting.com',
      firstName: 'Admin',
      lastName: 'Region B',
      role: Role.REGION_ADMIN,
      regionId: regionB.id,
      managedRegionId: regionB.id,
      phone: '+628123456702',
      bio: 'Administrator Wilayah Region B yang mengelola user, grup, dan komunitas Region B.',
    },
    {
      email: 'daniel@chatting.com',
      firstName: 'Daniel',
      lastName: 'Saptianus',
      role: Role.USER,
      regionId: regionA.id,
      managedRegionId: null,
      phone: '+628123456789',
      bio: 'Fullstack Developer di Region A.',
    },
    {
      email: 'sarah@chatting.com',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: Role.USER,
      regionId: regionA.id,
      managedRegionId: null,
      phone: '+628567890123',
      bio: 'Product Designer di Region A.',
    },
    {
      email: 'budi@chatting.com',
      firstName: 'Budi',
      lastName: 'Santoso',
      role: Role.USER,
      regionId: regionB.id,
      managedRegionId: null,
      phone: '+628789012345',
      bio: 'QA Specialist di Region B.',
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
          region_id: u.regionId,
          managed_region_id: u.managedRegionId,
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
      console.log(`   ➕ User created: ${u.email} (${u.role}, Region ID: ${u.regionId})`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          region_id: u.regionId,
          managed_region_id: u.managedRegionId,
        },
        include: { biodata: true },
      });

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
          first_name: u.firstName,
          last_name: u.lastName,
          phone: user.biodata?.phone || u.phone,
          bio: user.biodata?.bio || u.bio,
        },
      });
      console.log(`   ℹ️  User synced: ${u.email} (${u.role}, Region ID: ${u.regionId})`);
    }
    createdUsers[u.email] = user;
  }

  const superAdmin = createdUsers['superadmin@chatting.com'];
  const adminA = createdUsers['admin.a@chatting.com'];
  const adminB = createdUsers['admin.b@chatting.com'];
  const daniel = createdUsers['daniel@chatting.com'];
  const sarah = createdUsers['sarah@chatting.com'];
  const budi = createdUsers['budi@chatting.com'];

  // 3. Seed Communities Scoped by Region
  // Community A (Region A)
  let commA = await prisma.community.findFirst({
    where: { name: 'Komunitas ChatSphere Region A' },
  });
  if (!commA) {
    commA = await prisma.community.create({
      data: {
        name: 'Komunitas ChatSphere Region A',
        description: 'Pusat kolaborasi pengguna dan grup di Wilayah Region A.',
        created_by_id: adminA.id,
        region_id: regionA.id,
        members: {
          create: [
            { user_id: adminA.id, role: CommunityRole.COMMUNITY_OWNER },
            { user_id: daniel.id, role: CommunityRole.COMMUNITY_ADMIN },
            { user_id: sarah.id, role: CommunityRole.COMMUNITY_MEMBER },
          ],
        },
      },
    });
    console.log(`   ➕ Community created: ${commA.name} (Region A)`);
  }

  // Community B (Region B)
  let commB = await prisma.community.findFirst({
    where: { name: 'Komunitas ChatSphere Region B' },
  });
  if (!commB) {
    commB = await prisma.community.create({
      data: {
        name: 'Komunitas ChatSphere Region B',
        description: 'Pusat kolaborasi pengguna dan grup di Wilayah Region B.',
        created_by_id: adminB.id,
        region_id: regionB.id,
        members: {
          create: [
            { user_id: adminB.id, role: CommunityRole.COMMUNITY_OWNER },
            { user_id: budi.id, role: CommunityRole.COMMUNITY_MEMBER },
          ],
        },
      },
    });
    console.log(`   ➕ Community created: ${commB.name} (Region B)`);
  }

  // 4. Seed Groups Scoped by Region
  const groupsData = [
    {
      name: 'Pengumuman Region A',
      description: 'Saluran pengumuman resmi untuk Region A.',
      regionId: regionA.id,
      communityId: commA.id,
      creator: adminA,
      isAnnouncement: true,
      onlyAdminsCanPost: true,
      members: [adminA, daniel, sarah],
      sampleMessages: [
        { sender: adminA, text: 'Selamat datang di saluran Pengumuman Region A!' },
        { sender: adminA, text: 'Isolasi wilayah, video call WebRTC, dan screen share aktif di Region A.' },
      ],
    },
    {
      name: 'Diskusi & Proyek Region A',
      description: 'Grup diskusi umum member Region A.',
      regionId: regionA.id,
      communityId: commA.id,
      creator: daniel,
      isAnnouncement: false,
      onlyAdminsCanPost: false,
      members: [daniel, sarah, adminA],
      sampleMessages: [
        { sender: daniel, text: 'Halo Sarah! Ayo kita uji coba fitur Video Call 1-on-1 dan Screen Sharing!' },
        { sender: sarah, text: 'Siap Daniel, kamera dan mikrofon berfungsi lancar di peramban.' },
      ],
    },
    {
      name: 'Pengumuman Region B',
      description: 'Saluran pengumuman resmi untuk Region B.',
      regionId: regionB.id,
      communityId: commB.id,
      creator: adminB,
      isAnnouncement: true,
      onlyAdminsCanPost: true,
      members: [adminB, budi],
      sampleMessages: [
        { sender: adminB, text: 'Selamat datang di saluran Region B! Data terisolasi dari Region A.' },
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
          region_id: g.regionId,
          is_announcement: g.isAnnouncement,
          only_admins_can_post: g.onlyAdminsCanPost,
        },
      });
      console.log(`   ➕ Group created: ${g.name} (Region ID: ${g.regionId})`);

      // Link to community
      await prisma.communityGroup.create({
        data: {
          community_id: g.communityId,
          group_id: group.id,
          is_announcement: g.isAnnouncement,
        },
      });

      // Add members
      for (const u of g.members) {
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
    }
  }

  // 5. Seed Direct Messages within Region A
  const existingDm = await prisma.directMessage.findFirst({
    where: {
      OR: [
        { sender_id: daniel.id, receiver_id: sarah.id },
        { sender_id: sarah.id, receiver_id: daniel.id },
      ],
    },
  });

  if (!existingDm) {
    await prisma.directMessage.createMany({
      data: [
        {
          sender_id: daniel.id,
          receiver_id: sarah.id,
          content: 'Halo Sarah! Kita berada di Region A yang sama, jadi direct chat dan video call dapat berjalan lancar.',
          is_read: true,
          read_at: new Date(),
        },
        {
          sender_id: sarah.id,
          receiver_id: daniel.id,
          content: 'Iya betul! Budi yang di Region B tidak akan bisa direct message atau call kita berkat BR-TENANT-02.',
          is_read: true,
          read_at: new Date(),
        },
      ],
    });
    console.log(`   ➕ Direct messages seeded between Daniel and Sarah (Region A)`);
  }

  // 6. Seed Sample Call Sessions (Audio and Video Call)
  const existingCall = await prisma.callSession.findFirst({
    where: { caller_id: daniel.id, receiver_id: sarah.id },
  });

  if (!existingCall) {
    // 1 Video Call Completed
    await prisma.callSession.create({
      data: {
        caller_id: daniel.id,
        receiver_id: sarah.id,
        call_type: CallType.DIRECT,
        media_type: CallMediaType.VIDEO,
        region_id: regionA.id,
        status: CallStatus.COMPLETED,
        duration: 142,
        ended_at: new Date(),
      },
    });

    // 1 Audio Call Completed
    await prisma.callSession.create({
      data: {
        caller_id: sarah.id,
        receiver_id: daniel.id,
        call_type: CallType.DIRECT,
        media_type: CallMediaType.AUDIO,
        region_id: regionA.id,
        status: CallStatus.COMPLETED,
        duration: 68,
        ended_at: new Date(),
      },
    });
    console.log(`   📹 Video & Audio call sample sessions seeded`);
  }

  // 7. Seed Welcome Notifications
  await prisma.notification.createMany({
    data: [
      {
        user_id: superAdmin.id,
        type: NotificationType.USER_REGISTERED,
        title: 'Super Admin Siap',
        message: 'Akses penuh ke manajemen Region, penugasan Admin Region, dan observasi global.',
        is_read: false,
      },
      {
        user_id: adminA.id,
        type: NotificationType.USER_REGISTERED,
        title: 'Region Admin A Ditugaskan',
        message: 'Anda bertanggung jawab mengelola pengguna, grup, dan komunitas di Region A.',
        is_read: false,
      },
      {
        user_id: daniel.id,
        type: NotificationType.USER_REGISTERED,
        title: 'Selamat Datang di Region A',
        message: 'Akun Anda aktif di Region A dengan fitur Video Call WebRTC & Screen Sharing.',
        is_read: false,
      },
    ],
    skipDuplicates: true,
  });

  console.log('\n✨ Database seeding completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   - Total Regions: ${await prisma.region.count()}`);
  console.log(`   - Total Users: ${await prisma.user.count()}`);
  console.log(`   - Total Communities: ${await prisma.community.count()}`);
  console.log(`   - Total Groups: ${await prisma.group.count()}`);
  console.log(`   - Total Call Sessions: ${await prisma.callSession.count()}\n`);
  console.log('🔑 Default Accounts (Password: password123):');
  console.log('   1. Super Admin    : superadmin@chatting.com (SUPER_ADMIN, Global)');
  console.log('   2. Region Admin A : admin.a@chatting.com    (REGION_ADMIN, Region A)');
  console.log('   3. Region Admin B : admin.b@chatting.com    (REGION_ADMIN, Region B)');
  console.log('   4. User Daniel    : daniel@chatting.com     (USER, Region A)');
  console.log('   5. User Sarah     : sarah@chatting.com      (USER, Region A)');
  console.log('   6. User Budi      : budi@chatting.com       (USER, Region B)\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
