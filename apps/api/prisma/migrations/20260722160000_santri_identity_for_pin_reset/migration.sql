-- Identity display is used for procedural verification before an Admin confirms a PIN reset.
ALTER TABLE santri ADD COLUMN nis VARCHAR(30);
ALTER TABLE santri ADD COLUMN dormitory VARCHAR(60);
