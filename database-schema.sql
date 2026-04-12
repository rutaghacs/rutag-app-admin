-- Admin Portal Database Schema
-- Run this on your PostgreSQL database

-- Create database (if not exists)
-- CREATE DATABASE sensor_db;

-- Connect to the database
-- \c sensor_db;

-- ==================================
-- DEVICES TABLE
-- ==================================
CREATE TABLE IF NOT EXISTS devices (
    device_id VARCHAR(255) PRIMARY KEY,
    device_name VARCHAR(255),
    location VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_seen TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_devices_is_active ON devices(is_active);
CREATE INDEX idx_devices_created_at ON devices(created_at DESC);

-- ==================================
-- APP USERS TABLE
-- ==================================
CREATE TABLE IF NOT EXISTS app_users (
    user_id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    auth_provider VARCHAR(20) DEFAULT 'google',
    is_blocked BOOLEAN DEFAULT false,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_users_email ON app_users(email);
CREATE INDEX idx_users_is_blocked ON app_users(is_blocked);
CREATE INDEX idx_users_created_at ON app_users(created_at DESC);

-- ==================================
-- SAMPLE DATA (for testing)
-- ==================================

-- Insert sample devices
INSERT INTO devices (device_id, device_name, location, is_active, last_seen) VALUES
('rpi-001', 'Raspberry Pi 1', 'Lab Room A', true, NOW()),
('rpi-002', 'Raspberry Pi 2', 'Lab Room B', true, NOW() - INTERVAL '2 hours'),
('rpi-003', 'Raspberry Pi 3', 'Server Room', false, NOW() - INTERVAL '1 day'),
('rpi-004', 'Raspberry Pi 4', 'Workshop', true, NOW() - INTERVAL '30 minutes')
ON CONFLICT (device_id) DO NOTHING;

-- Insert sample users
INSERT INTO app_users (user_id, email, display_name, auth_provider, is_blocked, last_login) VALUES
('user-001', 'john.doe@example.com', 'John Doe', 'password', false, NOW()),
('user-002', 'jane.smith@example.com', 'Jane Smith', 'google', false, NOW() - INTERVAL '1 day'),
('user-003', 'blocked.user@example.com', 'Blocked User', 'password', true, NOW() - INTERVAL '7 days')
ON CONFLICT (user_id) DO NOTHING;

-- ==================================
-- USEFUL QUERIES
-- ==================================

-- Get all active devices
-- SELECT * FROM devices WHERE is_active = true;

-- Get all blocked users
-- SELECT * FROM app_users WHERE is_blocked = true;

-- Get dashboard statistics
-- SELECT 
--   (SELECT COUNT(*) FROM devices) as total_devices,
--   (SELECT COUNT(*) FROM devices WHERE is_active = true) as active_devices,
--   (SELECT COUNT(*) FROM app_users) as total_users,
--   (SELECT COUNT(*) FROM app_users WHERE is_blocked = true) as blocked_users;
