import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Uploads a local file and returns its public, stable, HTTPS URL — the
// format Buffer's API requires for image/video assets (no signed or
// expiring URLs; Cloudinary's delivery URLs are stable indefinitely).
export async function uploadToCloudinary(filePath, { resourceType = "auto", folder = "bharat100" } = {}) {
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: resourceType,
    folder,
  });
  return result.secure_url;
}
