declare module "@webgpu/types" {
  export interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    requestDevice(options?: GPUDeviceDescriptor): Promise<GPUDevice>;
  }
}
