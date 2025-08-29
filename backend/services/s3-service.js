const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');

class S3ServiceV2 {
  constructor() {
    // Configure AWS SDK v2
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.bucketPrefix = process.env.AWS_S3_BUCKET_PREFIX || 'dataroom-v2';
    this.region = process.env.AWS_REGION || 'us-east-1';
    
    console.log(`🔧 S3Service initialized for region: ${this.region}`);
  }

  getBucketName(clientId) {
    return `${this.bucketPrefix}-${clientId}-documents`;
  }

  async createClientBucket(clientId) {
    const bucketName = this.getBucketName(clientId);
    
    console.log(`📦 Creating S3 bucket for client ${clientId}: ${bucketName}`);
    
    try {
      // Check if bucket exists first
      await this.s3.headBucket({ Bucket: bucketName }).promise();
      console.log(`✅ S3 bucket already exists: ${bucketName}`);
      return bucketName;
    } catch (error) {
      if (error.statusCode === 404) {
        // Bucket doesn't exist, create it
        try {
          const createParams = {
            Bucket: bucketName
          };
          
          // Only add CreateBucketConfiguration for regions other than us-east-1
          if (this.region !== 'us-east-1') {
            createParams.CreateBucketConfiguration = {
              LocationConstraint: this.region
            };
          }
          
          await this.s3.createBucket(createParams).promise();
          
          // Configure bucket security
          await this.s3.putPublicAccessBlock({
            Bucket: bucketName,
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true
            }
          }).promise();

          console.log(`✅ S3 bucket created and configured: ${bucketName}`);
          return bucketName;
        } catch (createError) {
          if (createError.code === 'BucketAlreadyOwnedByYou') {
            console.log(`✅ S3 bucket already exists: ${bucketName}`);
            return bucketName;
          }
          throw createError;
        }
      } else {
        throw error;
      }
    }
  }

  getUploadMiddleware(clientId) {
    const bucketName = this.getBucketName(clientId);
    
    return multer({
      storage: multerS3({
        s3: this.s3,
        bucket: bucketName,
        key: (req, file, cb) => {
          const documentId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          const key = `documents/${documentId}/${sanitizedName}`;
          req.documentId = documentId; // Store for later use
          cb(null, key);
        },
        metadata: (req, file, cb) => {
          cb(null, {
            uploadedBy: req.user?.userId || 'unknown',
            uploadDate: new Date().toISOString(),
            originalName: file.originalname,
            clientId: clientId
          });
        },
        contentType: multerS3.AUTO_CONTENT_TYPE,
        serverSideEncryption: 'AES256',
        acl: 'private'
      }),
      limits: { 
        fileSize: 100 * 1024 * 1024, // 100MB
        files: 10
      },
      fileFilter: (req, file, cb) => {
        const allowed = /\.(pdf|jpe?g|png|txt|docx?|xlsx?|pptx?)$/i;
        if (allowed.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new Error('File type not allowed. Supported: PDF, images, text, Office documents'), false);
        }
      }
    });
  }

  async generateDownloadUrl(s3Key, bucketName, fileName = null, expiresIn = 3600) {
    try {
      const params = {
        Bucket: bucketName,
        Key: s3Key,
        Expires: expiresIn
      };

      if (fileName) {
        params.ResponseContentDisposition = `attachment; filename="${encodeURIComponent(fileName)}"`;
      }

      const url = await this.s3.getSignedUrlPromise('getObject', params);
      console.log(`🔗 Generated S3 pre-signed URL for ${s3Key} (expires in ${expiresIn}s)`);
      return url;
    } catch (error) {
      console.error(`❌ Failed to generate download URL for ${s3Key}:`, error);
      throw error;
    }
  }

  async getFile(s3Key, bucketName) {
    try {
      const params = {
        Bucket: bucketName,
        Key: s3Key
      };

      console.log(`📥 Downloading from S3: ${bucketName}/${s3Key}`);
      const result = await this.s3.getObject(params).promise();
      return result.Body;
    } catch (error) {
      console.error(`❌ Failed to get file from S3: ${bucketName}/${s3Key}`, error);
      throw error;
    }
  }

  async deleteFile(s3Key, bucketName) {
    try {
      const params = {
        Bucket: bucketName,
        Key: s3Key
      };

      console.log(`🗑️ Deleting from S3: ${bucketName}/${s3Key}`);
      const result = await this.s3.deleteObject(params).promise();
      return result;
    } catch (error) {
      console.error(`❌ Failed to delete from S3: ${bucketName}/${s3Key}`, error);
      throw error;
    }
  }

  async uploadFile(fileBuffer, fileName, contentType, clientId = 'demo-company', metadata = {}) {
  const bucketName = this.getBucketName(clientId);
  await this.createClientBucket(clientId);

  const documentId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `documents/${documentId}/${sanitizedName}`;

  const params = {
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    ServerSideEncryption: 'AES256'
    // NO METADATA - removing this completely for now
  };

  console.log(`📤 Uploading to S3: ${bucketName}/${key}`);
  const result = await this.s3.upload(params).promise();
  
  return {
    documentId,
    s3Key: key,
    s3Bucket: bucketName,
    s3Url: result.Location,
    etag: result.ETag,
    size: fileBuffer.length
  };
}

  async listFiles(bucketName, prefix = 'documents/', maxKeys = 1000) {
    try {
      const params = {
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys
      };

      const result = await this.s3.listObjectsV2(params).promise();
      return {
        files: result.Contents || [],
        isTruncated: result.IsTruncated,
        nextContinuationToken: result.NextContinuationToken
      };
    } catch (error) {
      console.error(`❌ Failed to list files in ${bucketName}:`, error);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    try {
      await this.s3.listBuckets().promise();
      return { 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        region: this.region,
        service: 'AWS S3'
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error.message, 
        timestamp: new Date().toISOString(),
        region: this.region,
        service: 'AWS S3'
      };
    }
  }

  // Get storage stats for a client
  async getStorageStats(clientId) {
    const bucketName = this.getBucketName(clientId);
    
    try {
      const result = await this.listFiles(bucketName, 'documents/');
      const totalSize = result.files.reduce((sum, file) => sum + (file.Size || 0), 0);

      return {
        bucketName,
        fileCount: result.files.length,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        totalSizeGB: Math.round(totalSize / (1024 * 1024 * 1024) * 1000) / 1000,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Error getting storage stats for ${clientId}:`, error);
      return { 
        bucketName,
        fileCount: 0, 
        totalSizeBytes: 0, 
        totalSizeMB: 0, 
        totalSizeGB: 0,
        error: error.message
      };
    }
  }
}

module.exports = S3ServiceV2;
