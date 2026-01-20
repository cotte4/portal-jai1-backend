# Performance Analysis Report

## Executive Summary

This report identifies performance anti-patterns, N+1 queries, and inefficient algorithms in the Portal JAI1 backend codebase. The analysis covers all service files, database schema, and common patterns that could impact application performance at scale.

---

## 1. N+1 Query Patterns

### 1.1 Sequential Notification Creation for Admins

**File:** `src/modules/progress/progress-automation.service.ts:193-205`

```typescript
// PROBLEM: Creates notifications one by one in a loop
for (const admin of admins) {
  try {
    await this.notificationsService.create(
      admin.id,
      'system',
      title,
      message,
    );
  } catch (error) {
    // ...
  }
}
```

**Impact:** Each admin notification triggers a separate database INSERT. With 10 admins, this results in 10 separate queries instead of 1.

**Solution:** Use Prisma's `createMany`:
```typescript
await this.prisma.notification.createMany({
  data: admins.map(admin => ({
    userId: admin.id,
    type: 'system',
    title,
    message,
  })),
});
```

### 1.2 Unnecessary Re-fetch After Adding Message

**File:** `src/modules/tickets/tickets.service.ts:252`

```typescript
// PROBLEM: After creating a message, fetches the entire ticket again
return this.findOne(ticketId, userId, userRole);
```

**Impact:** After `addMessage`, the service makes a complete new query with includes for user and all messages, when it could return just the new message or a minimal response.

**Solution:** Return only the newly created message or cache the previous `findOne` result and append the new message.

---

## 2. Redundant/Duplicate Queries

### 2.1 User Name Fetched After Transaction Already Has Context

**File:** `src/modules/clients/clients.service.ts:192-198`

```typescript
// Transaction completed above with profile and taxCase...

// PROBLEM: Makes another query for user name after transaction
const user = await this.prisma.user.findUnique({
  where: { id: userId },
  select: { firstName: true, lastName: true },
});
```

**Impact:** The transaction could have included the user data, avoiding this extra query.

**Solution:** Include user in the transaction or fetch user data before the transaction begins.

### 2.2 TaxCase Fetched Multiple Times in Progress Automation

**File:** `src/modules/progress/progress-automation.service.ts`

Multiple methods fetch the same TaxCase repeatedly:

- `checkAllDocsComplete()` (line 266) fetches taxCase
- Then calls `getClientName()` (line 283) which fetches user again
- `checkAndAdvanceStatus()` (line 236) fetches taxCase again

```typescript
// checkAllDocsComplete - fetches taxCase
const taxCase = await this.prisma.taxCase.findUnique({
  where: { id: taxCaseId },
  include: { clientProfile: true, documents: true },
});

// Then later calls getClientName which makes another query
const clientName = await this.getClientName(userId);
```

**Impact:** 3-4 extra queries per document upload event.

**Solution:** Pass the fetched data between methods or include user in the initial query.

### 2.3 Documents Service Makes Two Queries for User's Documents

**File:** `src/modules/documents/documents.service.ts:167-177`

```typescript
async findByUserId(userId: string) {
  // PROBLEM: First query - get clientProfile
  const clientProfile = await this.prisma.clientProfile.findUnique({
    where: { userId },
  });

  if (!clientProfile) {
    return [];
  }

  // Second query - get documents
  return this.findByClientId(clientProfile.id);
}
```

**Impact:** Two sequential queries when one query with proper joins would suffice.

**Solution:**
```typescript
async findByUserId(userId: string) {
  return this.prisma.document.findMany({
    where: {
      taxCase: {
        clientProfile: {
          userId,
        },
      },
    },
    orderBy: { uploadedAt: 'desc' },
  });
}
```

### 2.4 Document Upload Triggers Redundant Data Fetching

**File:** `src/modules/documents/documents.service.ts:112-145`

After upload, the service calls `progressAutomation.checkAllDocsComplete()` which refetches the taxCase that was just queried at line 39-42.

**Impact:** Duplicate taxCase fetch on every document upload.

**Solution:** Pass the already-fetched taxCase to the progress automation methods.

---

## 3. Missing Database Indexes

The following columns are frequently used in WHERE clauses but lack indexes:

### 3.1 Notification Table
```prisma
model Notification {
  // Missing indexes on frequently queried columns:
  userId    String  // Queried in findAll, markAllAsRead
  isRead    Boolean // Queried in findAll (unreadOnly), markAllAsRead, getUnreadCount

  // RECOMMENDED:
  // @@index([userId])
  // @@index([userId, isRead])
}
```

### 3.2 Ticket Table
```prisma
model Ticket {
  // Missing indexes:
  userId    String  // Queried in findAll
  status    TicketStatus // Queried in findAll with status filter

  // RECOMMENDED:
  // @@index([userId])
  // @@index([status])
}
```

### 3.3 TaxCase Table
```prisma
model TaxCase {
  // Missing indexes:
  internalStatus  InternalStatus // Used in admin filtering (clients.service.ts:386-388)
  clientStatus    ClientStatus   // Frequently queried

  // RECOMMENDED:
  // @@index([internalStatus])
  // @@index([clientStatus])
  // @@index([clientProfileId, taxYear])  // Already has @@unique, but explicit index may help
}
```

### 3.4 User Table
```prisma
model User {
  // Missing index:
  role  UserRole // Used to find all admins (progress-automation.service.ts:185)

  // RECOMMENDED:
  // @@index([role])
}
```

### 3.5 StatusHistory Table
```prisma
model StatusHistory {
  // Missing index:
  taxCaseId  String // Used in findOne joins

  // RECOMMENDED:
  // @@index([taxCaseId])
}
```

### 3.6 W2Estimate Table
```prisma
model W2Estimate {
  // Missing index:
  userId  String // Used in getEstimateHistory, getLatestEstimate

  // RECOMMENDED:
  // @@index([userId])
}
```

---

## 4. Inefficient Algorithms

### 4.1 Excel Export Loads All Clients Into Memory

**File:** `src/modules/clients/clients.service.ts:1039-1143`

```typescript
async exportToExcel(): Promise<Buffer> {
  // PROBLEM: Loads ALL clients with no pagination
  const clients = await this.prisma.clientProfile.findMany({
    include: {
      user: true,
      taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Then decrypts sensitive data for EVERY client
  for (const client of clients) {
    const decryptedSSN = client.ssn ? this.encryption.decrypt(client.ssn) : '';
    // ... more decryption
  }
}
```

**Impact:**
- Memory usage scales linearly with client count
- Decryption is CPU-intensive operation done for every record
- With 10,000 clients, this could cause memory issues and timeouts

**Solution:**
- Implement streaming with cursor-based pagination
- Process clients in batches (e.g., 100 at a time)
- Consider async generation with worker threads for large exports

### 4.2 Missing Items Calculation Done in Application Code

**File:** `src/modules/clients/clients.service.ts:433-492`

```typescript
// PROBLEM: Complex logic executed for each client in JavaScript
return {
  clients: results.map((client) => {
    const taxCase = client.taxCases[0];
    const missingItems: string[] = [];

    // 6+ conditional checks per client
    if (!client.ssn) missingItems.push('SSN');
    if (!client.dateOfBirth) missingItems.push('Fecha Nac.');
    // ... more checks

    const hasW2 = taxCase?.documents?.some(d => d.type === 'w2') || false;
    const hasPaymentProof = taxCase?.documents?.some(d => d.type === 'payment_proof') || false;
    // ...
  }),
};
```

**Impact:** Array iteration (`some()`) and multiple conditionals for each client. With 1000 clients, this is 6000+ operations in JavaScript.

**Solution:** Consider computing these flags in SQL or using Prisma's count aggregations, or caching computed values in the database.

---

## 5. Sequential Operations That Could Be Parallel

### 5.1 Multiple Status Notifications Created Sequentially

**File:** `src/modules/clients/clients.service.ts:788-816`

```typescript
// PROBLEM: Sequential await calls for independent operations
if (clientStatus && clientStatus !== previousClientStatus) {
  await this.notificationsService.create(...);
  // Email is fire-and-forget (good), but notification waits
}

if (federalStatus && federalStatus !== previousFederalStatus) {
  await this.notifyFederalStatusChange(...); // Creates notification inside
}

if (stateStatus && stateStatus !== previousStateStatus) {
  await this.notifyStateStatusChange(...); // Creates notification inside
}
```

**Impact:** Up to 3 sequential notification database writes when they could be parallel.

**Solution:** Use `Promise.all()` for independent operations:
```typescript
await Promise.all([
  clientStatus !== previousClientStatus && this.notificationsService.create(...),
  federalStatus !== previousFederalStatus && this.notifyFederalStatusChange(...),
  stateStatus !== previousStateStatus && this.notifyStateStatusChange(...),
].filter(Boolean));
```

---

## 6. Other Performance Concerns

### 6.1 Console.log Statements in Production Code

**Files:** Multiple service files contain `console.log` statements:
- `documents.service.ts:64-70, 80, 87-95, 109, 237`
- `calculator.service.ts:57-58, 103-107`
- `tickets.service.ts:106`

**Impact:** Console operations are synchronous and can impact performance under high load.

**Solution:** Remove console.log statements or use proper logging with log levels (already have Logger imported in most files).

### 6.2 Email Sending Without Queue

**Files:** `auth.service.ts`, `clients.service.ts`, `tickets.service.ts`

Emails are sent with fire-and-forget pattern (no await), but failures are only logged:

```typescript
this.emailService.sendWelcomeEmail(user.email, user.firstName)
  .catch((err) => this.logger.error('Failed to send welcome email', err));
```

**Impact:** No retry mechanism, no visibility into email delivery success rate, potential for lost emails during high load.

**Solution:** Consider implementing a job queue (Bull, BullMQ) for email operations.

### 6.3 OpenAI Client Created Lazily Without Connection Pooling

**File:** `src/modules/calculator/calculator.service.ts:28-37`

```typescript
private getOpenAI(): OpenAI {
  if (!this.openai) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
  }
  return this.openai;
}
```

**Impact:** Minor - lazy initialization is fine, but the check happens on every call. Consider initializing in constructor.

---

## 7. Recommendations Summary

### High Priority (Immediate Impact)
1. Add database indexes for `Notification`, `Ticket`, `TaxCase`, and `User` tables
2. Fix N+1 in `notifyAdmins()` using `createMany`
3. Optimize `findByUserId` in DocumentsService to use single query
4. Pass fetched data between methods in ProgressAutomationService

### Medium Priority
5. Implement streaming/batching for Excel export
6. Use `Promise.all()` for independent notification operations
7. Return minimal data after `addMessage` instead of full ticket

### Low Priority
8. Replace console.log with proper Logger usage
9. Consider job queue for email operations
10. Pre-compute missing items flags in database

---

## 8. Proposed Schema Changes

Add these indexes to `prisma/schema.prisma`:

```prisma
model Notification {
  // ... existing fields ...

  @@index([userId])
  @@index([userId, isRead])
}

model Ticket {
  // ... existing fields ...

  @@index([userId])
  @@index([status])
}

model TaxCase {
  // ... existing fields ...

  @@index([internalStatus])
  @@index([clientStatus])
}

model User {
  // ... existing fields ...

  @@index([role])
}

model StatusHistory {
  // ... existing fields ...

  @@index([taxCaseId])
}

model W2Estimate {
  // ... existing fields ...

  @@index([userId])
}
```

---

*Report generated: 2026-01-20*
