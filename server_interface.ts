export interface AdminConfig {
    leadCollection: string;
    leadSentCollection: string;
    ownersCollection: string;
    cardsCollection: string;
    project_id: string;
    projectId: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
    auth_provider_x509_cert_url: string;
    client_x509_cert_url: string;
  }
  

export interface CachedDocument {
    exists: boolean;
    data(): {
      html: string;
    } | undefined;
  }
  
export interface CacheData {
    html: string;
    timestamp: FirebaseFirestore.Timestamp;
    url: string;
    createdAt: number;
  }

