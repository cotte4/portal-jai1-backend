import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

/**
 * Documents Controller Unit Tests
 *
 * Tests the DocumentsController's routing and request handling for:
 * - Document upload
 * - Document listing
 * - Document download
 * - Document deletion
 */

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let documentsService: jest.Mocked<DocumentsService>;

  // Mock users
  const mockClientUser = {
    id: 'client-123',
    email: 'client@example.com',
    role: 'client',
  };

  const mockAdminUser = {
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin',
  };

  // Mock document data
  const mockDocument = {
    id: 'doc-123',
    userId: 'client-123',
    type: 'w2',
    filename: 'w2-2025.pdf',
    path: 'documents/client-123/w2-2025.pdf',
    mimeType: 'application/pdf',
    size: 102400,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDocumentsList = [mockDocument];

  beforeEach(async () => {
    const mockDocumentsService = {
      upload: jest.fn(),
      findByUserId: jest.fn(),
      findByClientId: jest.fn(),
      getDownloadUrl: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        { provide: DocumentsService, useValue: mockDocumentsService },
      ],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
    documentsService = module.get(DocumentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /documents/upload', () => {
    const uploadDto: UploadDocumentDto = {
      type: 'w2',
    };

    const mockFile = {
      originalname: 'w2-2025.pdf',
      mimetype: 'application/pdf',
      size: 102400,
      buffer: Buffer.from('test file content'),
    } as Express.Multer.File;

    it('should upload a document successfully', async () => {
      documentsService.upload.mockResolvedValue(mockDocument);

      const result = await controller.upload(mockClientUser, mockFile, uploadDto);

      expect(documentsService.upload).toHaveBeenCalledWith(
        mockClientUser.id,
        mockFile,
        uploadDto,
      );
      expect(result).toEqual(mockDocument);
    });

    it('should upload document with different type', async () => {
      const taxReturnDto: UploadDocumentDto = { type: 'tax_return' };
      const taxReturnDoc = { ...mockDocument, type: 'tax_return' };
      documentsService.upload.mockResolvedValue(taxReturnDoc);

      const result = await controller.upload(mockClientUser, mockFile, taxReturnDto);

      expect(documentsService.upload).toHaveBeenCalledWith(
        mockClientUser.id,
        mockFile,
        taxReturnDto,
      );
      expect(result.type).toBe('tax_return');
    });
  });

  describe('GET /documents', () => {
    it('should return documents for client user', async () => {
      documentsService.findByUserId.mockResolvedValue(mockDocumentsList);

      const result = await controller.findAll(mockClientUser, undefined);

      expect(documentsService.findByUserId).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(mockDocumentsList);
    });

    it('should return documents for specific client when admin queries', async () => {
      documentsService.findByClientId.mockResolvedValue(mockDocumentsList);

      const result = await controller.findAll(mockAdminUser, 'client-456');

      expect(documentsService.findByClientId).toHaveBeenCalledWith('client-456');
      expect(result).toEqual(mockDocumentsList);
    });

    it('should return own documents when admin does not specify client_id', async () => {
      documentsService.findByUserId.mockResolvedValue(mockDocumentsList);

      const result = await controller.findAll(mockAdminUser, undefined);

      expect(documentsService.findByUserId).toHaveBeenCalledWith(mockAdminUser.id);
      expect(result).toEqual(mockDocumentsList);
    });

    it('should return empty array when no documents found', async () => {
      documentsService.findByUserId.mockResolvedValue([]);

      const result = await controller.findAll(mockClientUser, undefined);

      expect(result).toEqual([]);
    });
  });

  describe('GET /documents/:id/download', () => {
    const mockDownloadResponse = {
      url: 'https://storage.example.com/signed-url?token=abc123',
      expiresAt: new Date(Date.now() + 3600000),
    };

    it('should return download URL for document owner', async () => {
      documentsService.getDownloadUrl.mockResolvedValue(mockDownloadResponse);

      const result = await controller.download(mockClientUser, 'doc-123');

      expect(documentsService.getDownloadUrl).toHaveBeenCalledWith(
        'doc-123',
        mockClientUser.id,
        mockClientUser.role,
      );
      expect(result).toEqual(mockDownloadResponse);
    });

    it('should allow admin to download any document', async () => {
      documentsService.getDownloadUrl.mockResolvedValue(mockDownloadResponse);

      const result = await controller.download(mockAdminUser, 'doc-456');

      expect(documentsService.getDownloadUrl).toHaveBeenCalledWith(
        'doc-456',
        mockAdminUser.id,
        mockAdminUser.role,
      );
      expect(result).toEqual(mockDownloadResponse);
    });
  });

  describe('DELETE /documents/:id', () => {
    it('should delete document for owner', async () => {
      const response = { message: 'Document deleted successfully' };
      documentsService.remove.mockResolvedValue(response);

      const result = await controller.remove(mockClientUser, 'doc-123');

      expect(documentsService.remove).toHaveBeenCalledWith(
        'doc-123',
        mockClientUser.id,
        mockClientUser.role,
      );
      expect(result).toEqual(response);
    });

    it('should allow admin to delete any document', async () => {
      const response = { message: 'Document deleted successfully' };
      documentsService.remove.mockResolvedValue(response);

      const result = await controller.remove(mockAdminUser, 'doc-456');

      expect(documentsService.remove).toHaveBeenCalledWith(
        'doc-456',
        mockAdminUser.id,
        mockAdminUser.role,
      );
      expect(result).toEqual(response);
    });
  });
});
