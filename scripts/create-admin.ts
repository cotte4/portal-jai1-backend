import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdmin() {
  const adminEmail = 'admin@jai1.com';
  const adminPassword = 'admin123'; // Change this to a secure password

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log('Admin user already exists - updating password and email verification...');
    await prisma.user.update({
      where: { email: adminEmail },
      data: {
        passwordHash: await bcrypt.hash(adminPassword, 10),
        emailVerified: true,
        isActive: true,
      },
    });
    console.log('Admin user updated successfully!');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${adminPassword}`);
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.admin,
      isActive: true,
      emailVerified: true, // Admin doesn't need email verification
    },
  });

  console.log('Admin user created successfully:');
  console.log(`Email: ${admin.email}`);
  console.log(`Password: ${adminPassword}`);
  console.log(`Role: ${admin.role}`);
}

createAdmin()
  .catch((error) => {
    console.error('Error creating admin user:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

